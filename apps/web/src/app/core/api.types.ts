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
  /** Newer firmware the device offers (Gen1: firmware id, Gen2+: version). */
  updateStable: string | null;
  updateBeta: string | null;
  updateCheckedAt: string | null;
}

export type FirmwareChannel = 'stable' | 'beta';

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
    /** Firmware update: channel and versions. */
    channel?: FirmwareChannel;
    from?: string | null;
    to?: string;
    /** Template: name, changed settings (secrets masked), reboot. */
    templateName?: string;
    changes?: { key: string; from: unknown; to: unknown }[];
    unsupported?: string[];
    restartRequired?: boolean;
    rebooted?: boolean;
    appliedSteps?: string[];
  } | null;
}

// --- Templates -------------------------------------------------------------------

export interface TemplateSettings {
  mqtt?: { enable?: boolean; server?: string; user?: string; clientId?: string; topicPrefix?: string };
  cloud?: { enable?: boolean };
  time?: { sntpServer?: string; timezone?: string; lat?: number; lon?: number };
  eco?: { ecoMode?: boolean; ledStatusDisable?: boolean };
  bluetooth?: { enable?: boolean; rpc?: boolean; observer?: boolean };
  wifiAp?: { enable?: boolean };
  apRoaming?: { enable?: boolean; threshold?: number };
  coiot?: { enable?: boolean; updatePeriod?: number; peer?: string };
  script?: { name: string; code: string; enable?: boolean; start?: boolean };
}

export interface Template {
  id: number;
  name: string;
  description: string | null;
  settings: TemplateSettings;
  createdAt: string;
  updatedAt: string;
}

export interface PlanItem {
  key: string;
  status: 'change' | 'same' | 'unsupported';
  current?: unknown;
  target?: unknown;
  reason?: 'generation' | 'firmware';
}

export interface TemplatePreview {
  mac: string;
  name: string | null;
  gen: number;
  state: DeviceState;
  basedOn: string | null;
  items: PlanItem[];
}

export interface ApplyTemplateResult {
  snapshotId: number;
  items: PlanItem[];
  changed: number;
  restartRequired: boolean;
  rebooted: boolean;
  script?: { created: boolean; codeChanged: boolean; enableChanged: boolean; started: boolean };
}
