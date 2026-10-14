// Mirrors the server's API shapes (apps/server/src/routes/*.ts).

export type ScanStatus = 'running' | 'done' | 'failed' | 'cancelled';

export type DeviceErrorCode = 'auth_required' | 'auth_invalid' | 'timeout' | 'network' | 'not_shelly' | 'http' | 'rpc' | 'internal';

export interface ScanSummary {
  id: string;
  range: string;
  status: ScanStatus;
  total: number;
  scanned: number;
  found: number;
  errors: number;
  withCredentials: boolean;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  missing: string[];
}

export interface ScanDeviceResult {
  ip: string;
  mac: string;
  gen: number;
  model: string | null;
  name: string | null;
  authRequired: boolean;
  created: boolean;
  snapshot: 'ok' | 'auth_required' | 'error';
  errorCode: DeviceErrorCode | null;
  error: string | null;
}

export interface ScanDetails extends ScanSummary {
  devices: ScanDeviceResult[];
}

export interface ApiError {
  error: string;
  message: string;
}

export type DeviceState = 'active' | 'reset' | 'missing';

export interface Device {
  mac: string;
  ip: string | null;
  gen: number;
  model: string | null;
  app: string | null;
  firmware: string | null;
  /** Local display name, falls back to the device's own name. */
  name: string | null;
  deviceName: string | null;
  authRequired: boolean;
  location: string | null;
  notes: string | null;
  state: DeviceState;
  firstSeen: string;
  lastSeen: string;
  lastSnapshotAt: string | null;
}

export interface Snapshot {
  id: number;
  takenAt: string;
  info: unknown;
  config: unknown;
  status: unknown;
}

export interface SnapshotMeta {
  id: number;
  takenAt: string;
  hasConfig: boolean;
}

export interface DeviceDetails {
  device: Device;
  latestSnapshot: Snapshot | null;
  snapshots: SnapshotMeta[];
}

export type LocalDeviceFields = Partial<Pick<Device, 'name' | 'location' | 'notes'>>;

export type ActionType = 'snapshot' | 'reboot' | 'factory_reset';

export interface ActionEntry {
  id: number;
  mac: string;
  deviceName: string | null;
  action: ActionType | string;
  requestedAt: string;
  requestedBy: string | null;
  finishedAt: string | null;
  result: 'ok' | 'error' | null;
  errorCode: string | null;
  error: string | null;
  details: {
    snapshotId?: number;
    snapshotSkipped?: boolean;
    snapshotError?: string;
    /** Factory reset: false when the device dropped the connection and was only re-checked afterwards. */
    confirmed?: boolean;
    recheck?: 'unreachable' | 'auth_disabled';
  } | null;
}
