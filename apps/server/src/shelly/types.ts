export type ShellyGen = 1 | 2 | 3 | 4;

/** Device credentials. Kept in memory only, never persisted or logged. Gen2+ always uses user "admin". */
export interface Credentials {
  username?: string;
  password: string;
}

/** Normalized identity of a device. The raw answer of `/shelly` is kept unchanged in `raw`. */
export interface DeviceInfo {
  /** 12 uppercase hex digits, the primary key. */
  mac: string;
  gen: ShellyGen;
  /** Gen1: `type`, Gen2+: `model`. */
  model: string | null;
  /** Gen2+ only, e.g. "Plus1PM". */
  app: string | null;
  /** Gen1: `fw`, Gen2+: `fw_id` (both "<build date>/<version>-<hash>"). */
  firmware: string | null;
  name: string | null;
  authRequired: boolean;
  raw: unknown;
}

export type FirmwareChannel = 'stable' | 'beta';

/** Newer firmware the device offers per channel; null = none. Gen1: firmware id, Gen2+: version ("1.5.0"). */
export interface FirmwareUpdates {
  stable: string | null;
  beta: string | null;
}

export interface ShellyAdapter {
  readonly host: string;
  getInfo(): Promise<DeviceInfo>;
  /** Raw JSON, store unchanged. */
  getConfig(): Promise<unknown>;
  getStatus(): Promise<unknown>;
  reboot(): Promise<void>;
  factoryReset(): Promise<void>;
  /** Asks the device (which asks the Shelly update server) for newer firmware. */
  checkForUpdate(): Promise<FirmwareUpdates>;
  /** Starts the OTA update; the device downloads, flashes and reboots on its own. */
  startUpdate(channel: FirmwareChannel): Promise<void>;
}

export interface AdapterOptions {
  credentials?: Credentials | undefined;
  /** Per request. */
  timeoutMs?: number;
}

export const DEFAULT_ADAPTER_TIMEOUT_MS = 5000;
