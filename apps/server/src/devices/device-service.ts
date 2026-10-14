import type { Db } from '../db/database.js';
import { finishAction, startAction, type ActionType } from '../db/actions.js';
import { getDevice, upsertSeenDevice, type DeviceRow } from '../db/devices.js';
import { insertSnapshot } from '../db/snapshots.js';
import { probeShelly } from '../shelly/detect.js';
import { ShellyAuthError, describeError, type DeviceErrorCode } from '../shelly/errors.js';
import { directHost, type HostResolver } from '../shelly/host-map.js';
import { createAdapter } from '../shelly/index.js';
import { DEFAULT_ADAPTER_TIMEOUT_MS, type Credentials, type DeviceInfo, type ShellyAdapter } from '../shelly/types.js';

export interface DeviceServiceOptions {
  hostFor: HostResolver;
  adapterTimeoutMs: number;
  now: () => string;
}

export type DeviceActionErrorCode = 'not_found' | 'no_ip' | 'mac_mismatch' | DeviceErrorCode;

export class DeviceActionError extends Error {
  override name = 'DeviceActionError';
  constructor(
    readonly code: DeviceActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Talks to one known device: always verifies its identity first, logs every action. */
export class DeviceService {
  private readonly options: DeviceServiceOptions;

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
  takeSnapshot(mac: string, credentials?: Credentials): Promise<number> {
    return this.logged(mac, 'snapshot', async (device) => {
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
  protected async connect(device: DeviceRow, credentials?: Credentials): Promise<{ info: DeviceInfo; adapter: ShellyAdapter }> {
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

  /** Runs `work` for a known device and records it in the action log (ok/error with code). */
  protected async logged<T>(mac: string, action: ActionType, work: (device: DeviceRow) => Promise<T>): Promise<T> {
    const device = getDevice(this.db, mac);
    if (!device) throw new DeviceActionError('not_found', `Unknown device ${mac}`);
    const actionId = startAction(this.db, mac, action, this.options.now());
    try {
      const result = await work(device);
      finishAction(this.db, actionId, this.options.now(), { result: 'ok' });
      return result;
    } catch (err) {
      const { code, message } = err instanceof DeviceActionError ? { code: err.code, message: err.message } : describeError(err);
      finishAction(this.db, actionId, this.options.now(), { result: 'error', code, message });
      throw err instanceof DeviceActionError ? err : new DeviceActionError(code, message);
    }
  }
}
