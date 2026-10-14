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
