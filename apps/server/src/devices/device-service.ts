import type { Db } from '../db/database.js';
import { finishAction, startAction, type ActionType } from '../db/actions.js';
import { getDevice, markReset, upsertSeenDevice, type DeviceRow } from '../db/devices.js';
import { insertSnapshot } from '../db/snapshots.js';
import { probeShelly } from '../shelly/detect.js';
import { ShellyAuthError, describeError, type DeviceErrorCode } from '../shelly/errors.js';
import { directHost, type HostResolver } from '../shelly/host-map.js';
import { createAdapter } from '../shelly/index.js';
import { normalizeMac } from '../shelly/mac.js';
import { DEFAULT_ADAPTER_TIMEOUT_MS, type Credentials, type DeviceInfo, type ShellyAdapter } from '../shelly/types.js';

export interface DeviceServiceOptions {
  hostFor: HostResolver;
  adapterTimeoutMs: number;
  now: () => string;
}

export type DeviceActionErrorCode =
  | 'not_found'
  | 'no_ip'
  | 'mac_mismatch'
  | 'busy'
  | 'confirm_mismatch'
  | 'snapshot_failed'
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
}

type ActionDetails = Record<string, unknown>;

/** Talks to one known device: verifies its identity first, logs every action, one action per device at a time. */
export class DeviceService {
  private readonly options: DeviceServiceOptions;
  private readonly busy = new Set<string>();

  constructor(
    private readonly db: Db,
    options: Partial<DeviceServiceOptions> = {},
  ) {
    this.options = {
      hostFor: directHost,
      adapterTimeoutMs: DEFAULT_ADAPTER_TIMEOUT_MS,
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

        const { adapter } = await this.connect(device, request.credentials);
        await adapter.factoryReset();
        markReset(this.db, mac);
        return { snapshotId };
      }),
    );
  }

  private snapshotUnlocked(mac: string, credentials: Credentials | undefined, ctx: ActionContext): Promise<number> {
    return this.logged(mac, 'snapshot', ctx, async (device) => {
      const { info, adapter } = await this.connect(device, credentials);
      const name = (await adapter.getInfo()).name;
      const config = await adapter.getConfig();
      const status = await adapter.getStatus();
      const now = this.options.now();
      return this.db.transaction(() => {
        upsertSeenDevice(this.db, { ...info, name }, device.ip ?? '', now);
        return insertSnapshot(this.db, { mac: info.mac, takenAt: now, info: info.raw, config, status });
      })();
    });
  }

  /**
   * Connects to the device at its last known IP and makes sure the same MAC answers there:
   * IPs move (DHCP), and an action must never hit a different device.
   */
  private async connect(device: DeviceRow, credentials?: Credentials): Promise<{ info: DeviceInfo; adapter: ShellyAdapter }> {
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
    return { info, adapter };
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
