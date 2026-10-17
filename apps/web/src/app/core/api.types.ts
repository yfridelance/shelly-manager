// Mirrors the server's API shapes (apps/server/src/routes/*.ts).

export type ScanStatus = 'running' | 'done' | 'failed' | 'cancelled';

export type DeviceErrorCode = 'auth_required' | 'auth_invalid' | 'timeout' | 'network' | 'not_shelly' | 'http' | 'rpc' | 'internal';

export interface Site {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  deviceCount: number;
  templateCount: number;
}

export interface ScanSummary {
  id: string;
  siteId: number;
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
  deviceId: string | null;
  authRequired: boolean;
  created: boolean;
  /** foreign: belongs to another site and was left untouched. */
  snapshot: 'ok' | 'auth_required' | 'error' | 'foreign';
  foreignSite?: { id: number; name: string };
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

/** Outputs, meters, inputs and sensors from the device's config (server: src/devices/functions.ts). */
export interface DeviceFunctions {
  switch: number;
  cover: number;
  light: number;
  meter: number;
  input: number;
  sensor: number;
  metering: boolean;
}

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
  /** Shelly device id: Gen2+ `id` (e.g. "shellyplus1pm-a8032ab12345"), Gen1 hostname. */
  deviceId: string | null;
  siteId: number;
  authRequired: boolean;
  location: string | null;
  notes: string | null;
  /** What is connected (local, free text, «Typ»). */
  kind: string | null;
  /** Derived from the newest snapshot; null while the config is unknown. */
  functions: DeviceFunctions | null;
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
  /** Last time the device answered with the same info/config (null = seen once). */
  confirmedAt: string | null;
  info: unknown;
  config: unknown;
  status: unknown;
}

export interface SnapshotMeta {
  id: number;
  takenAt: string;
  confirmedAt: string | null;
  hasConfig: boolean;
}

export interface DeviceDetails {
  device: Device;
  latestSnapshot: Snapshot | null;
  snapshots: SnapshotMeta[];
}

export type LocalDeviceFields = Partial<Pick<Device, 'name' | 'location' | 'notes' | 'kind'>>;

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
    /** Template with network settings: address change of the device. */
    ipChange?: { from: string | null; to: string | null; confirmed: boolean; dhcp?: boolean };
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
  network?: { sta?: NetworkSettings; sta1?: NetworkSettings };
}

export type WifiInterface = 'sta' | 'sta1';

export interface NetworkSettings {
  mode: 'dhcp' | 'static';
  /** Static: first address of the incremental assignment. */
  ipFrom?: string;
  netmask?: string;
  gateway?: string;
  dns?: string;
}

export interface Template {
  id: number;
  siteId: number;
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
  reason?: 'generation' | 'firmware' | 'password' | 'inactive' | 'no_ip' | 'gateway_cloud';
}

export interface TemplatePreview {
  mac: string;
  name: string | null;
  gen: number;
  state: DeviceState;
  basedOn: string | null;
  items: PlanItem[];
  /** Planned static IPs per WLAN interface. */
  assignedIps: Partial<Record<WifiInterface, string>>;
}

export interface ApplyTemplateResult {
  snapshotId: number;
  items: PlanItem[];
  changed: number;
  restartRequired: boolean;
  rebooted: boolean;
  /** WLAN the app talks through was reconfigured: address now in the inventory, and whether the device was found there. */
  network?: { ip: string | null; confirmed: boolean };
  script?: { created: boolean; codeChanged: boolean; enableChanged: boolean; started: boolean };
}
