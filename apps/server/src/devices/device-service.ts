import type { Db } from '../db/database.js';
import { finishAction, startAction, type ActionType } from '../db/actions.js';
import {
  getDevice,
  listDevices,
  markReset,
  recordDeviceName,
  recordFirmwareUpdates,
  updateDeviceIp,
  upsertSeenDevice,
  type DeviceRow,
} from '../db/devices.js';
import { getSnapshot, insertSnapshot } from '../db/snapshots.js';
import type { Template } from '../db/templates.js';
import { RpcAdapter } from '../shelly/rpc-adapter.js';
import { assignStaticIps, checkStaticIp, type IpProblem } from '../templates/ip-plan.js';
import {
  currentStaticIp,
  deviceNameStep,
  maxDeviceNameLength,
  planTemplate,
  type NetworkChange,
  type PlanItem,
} from '../templates/planner.js';
import type { TemplateSecrets, WifiInterface } from '../templates/settings.js';
import { NotAShellyError } from '../shelly/errors.js';
import { isRecord } from '../shelly/http.js';
import { probeShelly } from '../shelly/detect.js';
import { ShellyAuthError, ShellyNetworkError, ShellyTimeoutError, describeError, type DeviceErrorCode } from '../shelly/errors.js';
import { updatesFromStatus } from '../shelly/firmware.js';
import { directHost, type HostResolver } from '../shelly/host-map.js';
import { createAdapter } from '../shelly/index.js';
import { normalizeMac } from '../shelly/mac.js';
import {
  DEFAULT_ADAPTER_TIMEOUT_MS,
  type Credentials,
  type DeviceInfo,
  type FirmwareChannel,
  type ConfigStep,
  type FirmwareUpdates,
  type ShellyAdapter,
  type ShellyGen,
} from '../shelly/types.js';

export interface DeviceServiceOptions {
  hostFor: HostResolver;
  adapterTimeoutMs: number;
  /** Wait before re-probing a device whose connection broke off during the reset command. */
  resetRecheckDelayMs: number;
  /** After a WLAN IP change: wait before looking for the device, and how long to keep looking. */
  networkSettleMs: number;
  networkWaitMs: number;
  now: () => string;
}

const IP_PROBLEM_TEXT: Record<IpProblem | 'in_use', string> = {
  invalid: 'is not a valid address in the configured subnet',
  outside_subnet: 'is outside the subnet',
  reserved: 'is the network or broadcast address',
  gateway: 'is the gateway',
  taken: 'belongs to another device in the inventory',
  in_use: 'already answers on the network',
};

export const DEFAULT_RESET_RECHECK_DELAY_MS = 2500;

export type DeviceActionErrorCode =
  | 'not_found'
  | 'no_ip'
  | 'mac_mismatch'
  | 'busy'
  | 'confirm_mismatch'
  | 'snapshot_failed'
  | 'no_update'
  | 'template_failed'
  | 'ip_conflict'
  | 'invalid_name'
  | DeviceErrorCode;

export class DeviceActionError extends Error {
  override name = 'DeviceActionError';
  constructor(
    readonly code: DeviceActionErrorCode,
    message: string,
    /** For `snapshot_failed`: why the snapshot failed. */
    readonly causeCode?: string,
  ) {
    super(message);
  }
}

/** Who asked for an action. There are no user accounts, so this is the client address. */
export interface ActionContext {
  requestedBy?: string;
}

export interface FactoryResetRequest {
  /** Must match the device's MAC (separators and case do not matter). */
  confirmMac: string;
  credentials?: Credentials | undefined;
  /** Explicit override: reset even if the automatic pre-reset snapshot fails. */
  allowWithoutSnapshot?: boolean | undefined;
}

export interface FactoryResetResult {
  snapshotId: number | null;
  /**
   * false: the device dropped the connection before acknowledging the reset and was gone
   * (or unprotected) when probed again, so the reset very likely happened but was not confirmed.
   */
  confirmed: boolean;
}

type ActionDetails = Record<string, unknown>;

export interface ApplyTemplateRequest {
  credentials?: Credentials | undefined;
  /** Entered when applying, never stored or logged. */
  secrets?: TemplateSecrets | undefined;
  /** Reboot if a changed setting needs it (Gen2+ reports restart_required). */
  rebootIfRequired?: boolean | undefined;
  /** Planned static IPs per WLAN interface; missing ones are assigned here. */
  networkIps?: Partial<Record<WifiInterface, string>> | undefined;
}

export interface ApplyTemplateResult {
  snapshotId: number;
  items: PlanItem[];
  changed: number;
  restartRequired: boolean;
  rebooted: boolean;
  /** Set when the WLAN the app talks through got a new IP configuration. */
  network?: { ip: string | null; confirmed: boolean } | undefined;
  script?: { created: boolean; codeChanged: boolean; enableChanged: boolean; started: boolean } | undefined;
}

/** Talks to one known device: verifies its identity first, logs every action, one action per device at a time. */
export class DeviceService {
  private readonly options: DeviceServiceOptions;
  private readonly busy = new Set<string>();
  /** Static IPs handed out by running template applications (ip → mac), so parallel runs do not collide. */
  private readonly reservedIps = new Map<string, string>();

  constructor(
    private readonly db: Db,
    options: Partial<DeviceServiceOptions> = {},
  ) {
    this.options = {
      hostFor: directHost,
      adapterTimeoutMs: DEFAULT_ADAPTER_TIMEOUT_MS,
      resetRecheckDelayMs: DEFAULT_RESET_RECHECK_DELAY_MS,
      networkSettleMs: 3000,
      networkWaitMs: 30_000,
      now: () => new Date().toISOString(),
      ...options,
    };
  }

  /** Reads info, config and status and stores them as a new snapshot. Returns the snapshot id. */
  takeSnapshot(mac: string, credentials?: Credentials, ctx: ActionContext = {}): Promise<number> {
    return this.exclusive(mac, () => this.snapshotUnlocked(mac, credentials, ctx));
  }

  reboot(mac: string, credentials?: Credentials, ctx: ActionContext = {}): Promise<void> {
    return this.exclusive(mac, () =>
      this.logged(mac, 'reboot', ctx, async (device) => {
        const { adapter } = await this.connect(device, credentials);
        await adapter.reboot();
      }),
    );
  }

  /** Asks the device for newer firmware and remembers the answer. Read-only, therefore not logged. */
  checkFirmware(mac: string, credentials?: Credentials): Promise<FirmwareUpdates & { checkedAt: string }> {
    return this.exclusive(mac, async () => {
      const device = getDevice(this.db, mac);
      if (!device) throw new DeviceActionError('not_found', `Unknown device ${mac}`);
      try {
        const { adapter } = await this.connect(device, credentials);
        const updates = await adapter.checkForUpdate();
        const checkedAt = this.options.now();
        recordFirmwareUpdates(this.db, mac, updates, checkedAt);
        return { ...updates, checkedAt };
      } catch (err) {
        if (err instanceof DeviceActionError) throw err;
        const { code, message } = describeError(err);
        throw new DeviceActionError(code, message);
      }
    });
  }

  /**
   * Starts an OTA update of one device on the given channel. Checks first that the device really
   * offers a newer version there (409 no_update otherwise). The device flashes and reboots by itself;
   * the new firmware shows up with the next scan or snapshot.
   */
  updateFirmware(mac: string, channel: FirmwareChannel, credentials?: Credentials, ctx: ActionContext = {}): Promise<{ version: string }> {
    return this.exclusive(mac, () =>
      this.logged(mac, 'firmware_update', ctx, async (device, details) => {
        const { info, adapter } = await this.connect(device, credentials);
        const updates = await adapter.checkForUpdate();
        recordFirmwareUpdates(this.db, mac, updates, this.options.now());
        const version = updates[channel];
        details.channel = channel;
        details.from = info.firmware;
        if (!version) throw new DeviceActionError('no_update', `${mac} offers no ${channel} update`);
        details.to = version;
        await adapter.startUpdate(channel);
        return { version };
      }),
    );
  }

  /**
   * Writes a name to the device (Gen1 /settings?name=, Gen2+ Sys.SetConfig device.name). Afterwards
   * the local name equals the device name again; a snapshot documents the new state.
   */
  renameOnDevice(mac: string, name: string, credentials?: Credentials, ctx: ActionContext = {}): Promise<{ name: string; snapshotId: number | null }> {
    return this.exclusive(mac, () =>
      this.logged(mac, 'rename', ctx, async (device, details) => {
        const target = name.trim().replace(/\s+/g, ' ');
        details.from = device.device_name;
        details.to = target;
        if (!target) throw new DeviceActionError('invalid_name', 'The name must not be empty');
        const max = maxDeviceNameLength(device.gen as ShellyGen);
        if (target.length > max) throw new DeviceActionError('invalid_name', `The name is longer than ${max} characters`);
        const { info, adapter } = await this.connect(device, credentials);
        await adapter.applyConfig(deviceNameStep(info.gen, target));
        recordDeviceName(this.db, mac, target);
        let snapshotId: number | null = null;
        try {
          snapshotId = await this.snapshotUnlocked(mac, credentials, ctx);
          details.snapshotAfterId = snapshotId;
        } catch (err) {
          details.snapshotAfterError = err instanceof DeviceActionError ? err.code : describeError(err).code;
        }
        return { name: target, snapshotId };
      }),
    );
  }

  /**
   * Applies a template to one device: 1. snapshot of the current state (blocks on failure, like
   * a reset), 2. plan against that fresh config, 3. send only differing settings, 4. deploy the
   * script if any, 5. reboot if required and wanted. Logged with every change (secrets masked).
   */
  applyTemplate(mac: string, template: Template, request: ApplyTemplateRequest = {}, ctx: ActionContext = {}): Promise<ApplyTemplateResult> {
    return this.exclusive(mac, () =>
      this.logged(mac, 'apply_template', ctx, async (device, details) => {
        details.templateId = template.id;
        details.templateName = template.name;

        const snapshotId = await this.snapshotUnlocked(mac, request.credentials, ctx).catch((err: unknown) => {
          const cause = err instanceof DeviceActionError ? err.code : describeError(err).code;
          throw new DeviceActionError('snapshot_failed', `Snapshot before applying failed (${cause}); nothing changed`, cause);
        });
        details.snapshotId = snapshotId;
        const snapshot = getSnapshot(this.db, mac, snapshotId);
        const config = snapshot?.config_json ? (JSON.parse(snapshot.config_json) as unknown) : undefined;
        const info = snapshot ? (JSON.parse(snapshot.info_json) as unknown) : undefined;

        const { info: live, adapter } = await this.connect(device, request.credentials);
        // {id}: Gen1 hostname from /settings, Gen2+ device id from /shelly.
        const deviceId =
          live.gen === 1
            ? String((isRecord(config) && isRecord(config['device']) && config['device']['hostname']) || mac)
            : String((isRecord(info) && info['id']) || mac);
        const reserved: string[] = [];
        try {
          const assignedIps = await this.assignIps(mac, live, config, template, request.networkIps, device.ip, reserved);
          const local = { name: device.name ?? device.device_name, floor: device.floor, location: device.location, kind: device.kind };
          const plan = planTemplate(live.gen, config, template.settings, { deviceId, mac, assignedIps, local }, request.secrets);

          let restartRequired = false;
          const done: string[] = [];
          const run = async (step: ConfigStep, a: ShellyAdapter = adapter): Promise<void> => {
            const res = await a.applyConfig(step);
            restartRequired ||= res.restartRequired;
            done.push(step.kind === 'gen1' ? step.path : step.method);
          };
          try {
            for (const step of plan.steps) await run(step);
            // A new device name becomes the local name too (like renaming a single device).
            const renamed = plan.items.find((i) => i.key === 'device.name' && i.status === 'change');
            if (renamed && typeof renamed.target === 'string') recordDeviceName(this.db, mac, renamed.target);
          } catch (err) {
            details.appliedSteps = done;
            const { code, message } = describeError(err);
            throw new DeviceActionError('template_failed', `Applying failed after ${done.length} of ${plan.steps.length} calls: ${message}`, code);
          }

          let script: ApplyTemplateResult['script'];
          if (plan.script) {
            if (!(adapter instanceof RpcAdapter)) throw new DeviceActionError('template_failed', 'Scripts need a Gen2+ device');
            const r = await adapter.deployScript(plan.script.name, plan.script.code, plan.script.enable, plan.script.start);
            script = { created: r.created, codeChanged: r.codeChanged, enableChanged: r.enableChanged, started: r.started };
          }

          // WLAN changes last; the interface the device is connected through goes very last,
          // because the device reconnects about a second after storing it.
          const activeIface = activeWifiInterface(live.gen, config, snapshot?.status_json ? (JSON.parse(snapshot.status_json) as unknown) : undefined);
          const ordered = [...plan.network].sort((a, b) => Number(a.iface === activeIface) - Number(b.iface === activeIface));
          let networkResult: ApplyTemplateResult['network'];
          for (const change of ordered) {
            try {
              await run(change.step);
            } catch (err) {
              details.appliedSteps = done;
              const { code, message } = describeError(err);
              throw new DeviceActionError('template_failed', `Network change of ${change.iface} failed: ${message}`, code);
            }
            if (change.iface === activeIface) networkResult = await this.followNetworkChange(mac, device.ip, change, details);
          }

          // Document the new state (before a reboot takes the device away for a moment).
          const reachable = networkResult === undefined || networkResult.confirmed;
          if ((plan.steps.length > 0 || plan.script || plan.network.length > 0) && reachable) {
            try {
              details.snapshotAfterId = await this.snapshotUnlocked(mac, request.credentials, ctx);
            } catch (err) {
              details.snapshotAfterError = err instanceof DeviceActionError ? err.code : describeError(err).code;
            }
          }

          let rebooted = false;
          if (restartRequired && request.rebootIfRequired && reachable) {
            // After an IP change the old adapter points to the old address; connect again (checks the MAC).
            const now = getDevice(this.db, mac);
            const { adapter: current } = networkResult && now ? await this.connect(now, request.credentials) : { adapter };
            await current.reboot();
            rebooted = true;
          } else if (restartRequired && request.rebootIfRequired) {
            details.rebootSkipped = 'unreachable';
          }

        // A script whose code, autostart and run state already matched counts as unchanged.
        const scriptChanged = !!script && (script.created || script.codeChanged || script.enableChanged || script.started);
        const items = plan.items.map((i) => (i.key === 'script' && i.status === 'change' && !scriptChanged ? { ...i, status: 'same' as const } : i));
        const changes = items.filter((i) => i.status === 'change');
        details.changes = changes.map((i) => ({ key: i.key, from: i.current ?? null, to: i.target ?? null }));
        details.unsupported = items.filter((i) => i.status === 'unsupported').map((i) => i.key);
        details.restartRequired = restartRequired;
        details.rebooted = rebooted;
        if (script) details.script = script;
        if (networkResult) details.network = networkResult;
        return { snapshotId, items, changed: changes.length, restartRequired, rebooted, network: networkResult, script };
        } finally {
          for (const ip of reserved) this.reservedIps.delete(ip);
        }
      }),
    );
  }

  /**
   * Static IPs for this device per WLAN interface: the requested ones (validated), otherwise the
   * next free one from the template's range. A candidate that is not the device's own current
   * address must not answer on the network. Reserved until the application ends.
   */
  private async assignIps(
    mac: string,
    live: DeviceInfo,
    config: unknown,
    template: Template,
    requested: Partial<Record<WifiInterface, string>> | undefined,
    ownIp: string | null,
    reserved: string[],
  ): Promise<Partial<Record<WifiInterface, string>>> {
    const result: Partial<Record<WifiInterface, string>> = {};
    for (const iface of ['sta', 'sta1'] as const) {
      const n = template.settings.network?.[iface];
      if (n?.mode !== 'static' || !n.ipFrom || !n.netmask) continue;
      const cfg = { ipFrom: n.ipFrom, netmask: n.netmask, gateway: n.gateway };
      const taken = new Map<string, string>(this.reservedIps);
      // Addresses are only unique within a site.
      const siteId = getDevice(this.db, mac)?.site_id;
      for (const d of listDevices(this.db, siteId)) if (d.ip && !taken.has(d.ip)) taken.set(d.ip, d.mac);
      const current = currentStaticIp(live.gen, config, iface);

      let ip = requested?.[iface];
      if (ip) {
        const problem = checkStaticIp(ip, cfg, mac, taken);
        if (problem) throw new DeviceActionError('ip_conflict', `${ip} ${IP_PROBLEM_TEXT[problem]}; nothing changed`);
      } else {
        ip = assignStaticIps([{ mac, currentStatic: current }], cfg, taken).get(mac);
      }
      if (!ip) continue;
      if (ip !== current && ip !== ownIp && (await this.addressInUse(ip))) {
        throw new DeviceActionError('ip_conflict', `${ip} ${IP_PROBLEM_TEXT.in_use}; nothing changed`);
      }
      this.reservedIps.set(ip, mac);
      reserved.push(ip);
      result[iface] = ip;
    }
    return result;
  }

  /** Something answers HTTP at this address (a Shelly or anything else). Devices without a web server stay unnoticed. */
  private async addressInUse(ip: string): Promise<boolean> {
    try {
      await probeShelly(this.options.hostFor(ip), Math.min(this.options.adapterTimeoutMs, 1500));
      return true;
    } catch (err) {
      return err instanceof NotAShellyError;
    }
  }

  /**
   * After changing the WLAN the app talks through: find the device again and update the inventory.
   * Static: at the new address. DHCP: the address is unknown unless the device answers at the old one.
   */
  private async followNetworkChange(
    mac: string,
    oldIp: string | null,
    change: NetworkChange,
    details: ActionDetails,
  ): Promise<{ ip: string | null; confirmed: boolean }> {
    const target = change.mode === 'static' ? change.ip : oldIp;
    await new Promise((resolve) => setTimeout(resolve, this.options.networkSettleMs));
    const deadline = Date.now() + this.options.networkWaitMs;
    let found = false;
    while (target && !found && Date.now() <= deadline) {
      try {
        found = (await probeShelly(this.options.hostFor(target), 1500)).mac === mac;
      } catch {
        // not (yet) reachable
      }
      if (!found) await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (change.mode === 'static') {
      // Keep the intended address even if unconfirmed: that is where the device most likely is.
      updateDeviceIp(this.db, mac, change.ip);
      details.ipChange = { from: oldIp, to: change.ip, confirmed: found };
      return { ip: change.ip, confirmed: found };
    }
    if (!found) updateDeviceIp(this.db, mac, null);
    details.ipChange = { from: oldIp, to: found ? oldIp : null, confirmed: found, dhcp: true };
    return { ip: found ? oldIp : null, confirmed: found };
  }

  /**
   * Factory reset of exactly one device (there is deliberately no bulk variant).
   * 1. confirmMac must match, 2. a snapshot is taken automatically; if that fails the reset is
   * blocked unless `allowWithoutSnapshot` is set, 3. the device identity is verified again,
   * 4. reset, 5. the record is kept with state `reset`.
   */
  factoryReset(mac: string, request: FactoryResetRequest, ctx: ActionContext = {}): Promise<FactoryResetResult> {
    return this.exclusive(mac, () =>
      this.logged(mac, 'factory_reset', ctx, async (device, details) => {
        if (!sameMac(request.confirmMac, mac)) {
          throw new DeviceActionError('confirm_mismatch', `Confirmation "${request.confirmMac}" does not match ${mac}`);
        }

        let snapshotId: number | null = null;
        try {
          snapshotId = await this.snapshotUnlocked(mac, request.credentials, ctx);
          details.snapshotId = snapshotId;
        } catch (err) {
          const cause = err instanceof DeviceActionError ? err.code : describeError(err).code;
          details.snapshotError = cause;
          if (!request.allowWithoutSnapshot) {
            throw new DeviceActionError('snapshot_failed', `Snapshot before reset failed (${cause}); reset not executed`, cause);
          }
          details.snapshotSkipped = true;
        }

        const { info, host, adapter } = await this.connect(device, request.credentials);
        let confirmed = true;
        try {
          await adapter.factoryReset();
        } catch (err) {
          if (!(err instanceof ShellyTimeoutError || err instanceof ShellyNetworkError)) throw err;
          const recheck = await this.recheckAfterBrokenReset(host, info);
          if (recheck === 'unchanged') throw err;
          details.confirmed = false;
          details.resetError = describeError(err).code;
          details.recheck = recheck;
          confirmed = false;
        }
        markReset(this.db, mac);
        return { snapshotId, confirmed };
      }),
    );
  }

  /**
   * Real devices may reboot into AP mode before the reset answer leaves the socket, so the
   * command ends in a timeout or a dropped connection. Probe the same IP once more:
   * - `unreachable`: no answer at all, as expected after a reset.
   * - `auth_disabled`: the same device answers, but its password protection is gone.
   * - `unchanged`: something still answers as before (same device unchanged, or another device), so report the error.
   */
  private async recheckAfterBrokenReset(host: string, before: DeviceInfo): Promise<'unreachable' | 'auth_disabled' | 'unchanged'> {
    await new Promise((resolve) => setTimeout(resolve, this.options.resetRecheckDelayMs));
    let after: DeviceInfo;
    try {
      after = await probeShelly(host, this.options.adapterTimeoutMs);
    } catch (err) {
      if (err instanceof ShellyTimeoutError || err instanceof ShellyNetworkError) return 'unreachable';
      return 'unchanged';
    }
    if (after.mac === before.mac && before.authRequired && !after.authRequired) return 'auth_disabled';
    return 'unchanged';
  }

  private snapshotUnlocked(mac: string, credentials: Credentials | undefined, ctx: ActionContext): Promise<number> {
    return this.logged(mac, 'snapshot', ctx, async (device) => {
      const { info, adapter } = await this.connect(device, credentials);
      const { name, deviceId } = await adapter.getInfo();
      const config = await adapter.getConfig();
      const status = await adapter.getStatus();
      const now = this.options.now();
      return this.db.transaction(() => {
        upsertSeenDevice(this.db, { ...info, name, deviceId }, device.ip ?? '', now, device.site_id);
        const updates = updatesFromStatus(info.gen, status);
        if (updates) recordFirmwareUpdates(this.db, info.mac, updates, now);
        return insertSnapshot(this.db, { mac: info.mac, takenAt: now, info: info.raw, config, status });
      })();
    });
  }

  /**
   * Connects to the device at its last known IP and makes sure the same MAC answers there:
   * IPs move (DHCP), and an action must never hit a different device.
   */
  private async connect(device: DeviceRow, credentials?: Credentials): Promise<{ info: DeviceInfo; host: string; adapter: ShellyAdapter }> {
    if (!device.ip) throw new DeviceActionError('no_ip', `No known IP address for ${device.mac}`);
    const host = this.options.hostFor(device.ip);
    const info = await probeShelly(host, this.options.adapterTimeoutMs);
    if (info.mac !== device.mac) {
      throw new DeviceActionError('mac_mismatch', `${device.ip} is now ${info.mac}, not ${device.mac}. Please rescan.`);
    }
    if (info.authRequired && !credentials) throw new ShellyAuthError(host, 'required');
    const adapter = createAdapter(host, info.gen, {
      // Only protected devices ever receive credentials.
      credentials: info.authRequired ? credentials : undefined,
      timeoutMs: this.options.adapterTimeoutMs,
    });
    return { info, host, adapter };
  }

  /** Rejects a second action on the same device while one is running (double clicks, two tabs). */
  private async exclusive<T>(mac: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(mac)) throw new DeviceActionError('busy', `Another action is running on ${mac}`);
    this.busy.add(mac);
    try {
      return await work();
    } finally {
      this.busy.delete(mac);
    }
  }

  /** Runs `work` for a known device and records it in the action log (ok/error with code and details). */
  private async logged<T>(
    mac: string,
    action: ActionType,
    ctx: ActionContext,
    work: (device: DeviceRow, details: ActionDetails) => Promise<T>,
  ): Promise<T> {
    const device = getDevice(this.db, mac);
    if (!device) throw new DeviceActionError('not_found', `Unknown device ${mac}`);
    const actionId = startAction(this.db, mac, action, this.options.now(), ctx.requestedBy);
    const details: ActionDetails = {};
    try {
      const result = await work(device, details);
      finishAction(this.db, actionId, this.options.now(), { result: 'ok' }, details);
      return result;
    } catch (err) {
      const { code, message } = err instanceof DeviceActionError ? { code: err.code, message: err.message } : describeError(err);
      finishAction(this.db, actionId, this.options.now(), { result: 'error', code, message }, details);
      throw err instanceof DeviceActionError ? err : new DeviceActionError(code, message);
    }
  }
}

function sameMac(input: string, mac: string): boolean {
  try {
    return normalizeMac(input) === mac;
  } catch {
    return false;
  }
}

/**
 * The WLAN interface the device is currently connected through: sta1 if the connected SSID is the
 * fallback network's, otherwise sta. Gen1: status.wifi_sta.ssid, Gen2+: status.wifi.ssid.
 */
function activeWifiInterface(gen: ShellyGen, config: unknown, status: unknown): WifiInterface {
  const get = (obj: unknown, ...path: string[]): unknown =>
    path.reduce<unknown>((acc, k) => (isRecord(acc) ? acc[k] : undefined), obj);
  const ssid = gen === 1 ? get(status, 'wifi_sta', 'ssid') : get(status, 'wifi', 'ssid');
  const sta1Ssid = gen === 1 ? get(config, 'wifi_sta1', 'ssid') : get(config, 'wifi', 'sta1', 'ssid');
  return typeof ssid === 'string' && ssid !== '' && ssid === sta1Ssid ? 'sta1' : 'sta';
}
