import { isRecord } from '../shelly/http.js';
import type { ConfigStep, ShellyGen } from '../shelly/types.js';
import type { NetworkSettings, TemplateSecrets, TemplateSettings, WifiInterface } from './settings.js';

// Translates curated template settings into device calls for one device, based on its current
// configuration (Gen1: /settings, Gen2+: Shelly.GetConfig). Pure functions, no I/O.
//
// Rules:
// - Only fields set in the template are touched.
// - A field the device's current config does not have is reported as `unsupported` (firmware/model)
//   and never sent: unknown parameters would fail or be ignored silently.
// - Values that already match produce no call.

export type PlanStatus = 'change' | 'same' | 'unsupported';

export interface PlanItem {
  /** e.g. "mqtt.server"; the UI maps it to a German label. */
  key: string;
  status: PlanStatus;
  current?: unknown;
  target?: unknown;
  /**
   * For `unsupported`: not available on this generation, missing in this firmware/model, or a
   * password is needed that was not given (enabling the AP).
   */
  reason?: 'generation' | 'firmware' | 'password' | 'inactive' | 'no_ip' | 'gateway_cloud' | 'name_empty' | 'name_too_long';
}

export interface ScriptPlan {
  name: string;
  code: string;
  enable: boolean | undefined;
  start: boolean;
}

export interface NetworkChange {
  iface: WifiInterface;
  step: ConfigStep;
  mode: 'dhcp' | 'static';
  /** Static: the new address; dhcp: null. */
  ip: string | null;
}

export interface TemplatePlan {
  items: PlanItem[];
  steps: ConfigStep[];
  /** WLAN client changes, kept apart: they are sent last because the device reconnects. */
  network: NetworkChange[];
  /** Gen2+ script deployment; code is compared on the device when applying. */
  script?: ScriptPlan;
}

export interface PlanContext {
  /** Gen1: hostname (e.g. "shelly1-A1B2C3"), Gen2+: device id. Used for {id}. */
  deviceId: string;
  mac: string;
  /** Static IP per WLAN interface, assigned beforehand (preview or apply), see ip-plan.ts. */
  assignedIps?: Partial<Record<WifiInterface, string>> | undefined;
  /** Local inventory fields for the device name placeholders {name}, {floor}, {location}, {kind}. */
  local?: { name?: string | null; floor?: string | null; location?: string | null; kind?: string | null } | undefined;
}

/**
 * Longest device name the device accepts. Gen1: 30 characters (official Gen1 changelog 1.9.0:
 * "Limit device and channel name up to 30 characters"). Gen2+: the docs give no limit; 64 is our
 * own cap until confirmed on a real device.
 */
export function maxDeviceNameLength(gen: ShellyGen): number {
  return gen === 1 ? 30 : 64;
}

/** Gen1 GET /settings?name=…, Gen2+ Sys.SetConfig { device: { name } } (both in the official docs). */
export function deviceNameStep(gen: ShellyGen, name: string): ConfigStep {
  return gen === 1
    ? { kind: 'gen1', path: '/settings', params: { name } }
    : { kind: 'rpc', method: 'Sys.SetConfig', params: { config: { device: { name } } } };
}

/** Fills a device name pattern; empty placeholders collapse, so no double spaces remain. */
export function fillDeviceName(pattern: string, ctx: PlanContext): string {
  const values: Record<string, string> = {
    name: ctx.local?.name ?? '',
    floor: ctx.local?.floor ?? '',
    location: ctx.local?.location ?? '',
    kind: ctx.local?.kind ?? '',
    id: ctx.deviceId,
    mac: ctx.mac,
  };
  return pattern
    .replace(/\{(name|floor|location|kind|id|mac)\}/g, (_, key: string) => values[key] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Shown instead of secret values in plans and logs. */
export const SECRET_MASK = '********';

type Cfg = Record<string, unknown>;

interface Gen1Mapping {
  read: (settings: Cfg) => unknown;
  write: (value: unknown, settings: Cfg) => { path: string; params: Record<string, unknown> };
}

interface RpcMapping {
  read: (config: Cfg) => unknown;
  /** Partial config for `<component>.SetConfig`, e.g. { method: 'MQTT.SetConfig', config: { server } }. */
  write: (value: unknown, config: Cfg) => { method: string; config: Cfg };
}

interface FieldDef {
  key: string;
  target: (s: TemplateSettings, ctx: PlanContext) => unknown;
  gen1?: Gen1Mapping;
  rpc?: RpcMapping;
}

const at = (obj: unknown, ...path: string[]): unknown => {
  let cur = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
};

const fill = (template: string | undefined, ctx: PlanContext): string | undefined =>
  template?.replaceAll('{id}', ctx.deviceId).replaceAll('{mac}', ctx.mac);

const settings1 = (params: Record<string, unknown>) => ({ path: '/settings', params });

const FIELDS: FieldDef[] = [
  // --- MQTT -------------------------------------------------------------------
  {
    key: 'mqtt.enable',
    target: (s) => s.mqtt?.enable,
    gen1: { read: (c) => at(c, 'mqtt', 'enable'), write: (v) => settings1({ mqtt_enable: v }) },
    rpc: { read: (c) => at(c, 'mqtt', 'enable'), write: (v) => ({ method: 'MQTT.SetConfig', config: { enable: v } }) },
  },
  {
    key: 'mqtt.server',
    target: (s) => s.mqtt?.server,
    gen1: { read: (c) => at(c, 'mqtt', 'server'), write: (v) => settings1({ mqtt_server: v }) },
    rpc: { read: (c) => at(c, 'mqtt', 'server'), write: (v) => ({ method: 'MQTT.SetConfig', config: { server: v } }) },
  },
  {
    key: 'mqtt.user',
    target: (s) => s.mqtt?.user,
    gen1: { read: (c) => at(c, 'mqtt', 'user'), write: (v) => settings1({ mqtt_user: v }) },
    rpc: { read: (c) => at(c, 'mqtt', 'user'), write: (v) => ({ method: 'MQTT.SetConfig', config: { user: v } }) },
  },
  {
    key: 'mqtt.clientId',
    target: (s, ctx) => fill(s.mqtt?.clientId, ctx),
    gen1: { read: (c) => at(c, 'mqtt', 'id'), write: (v) => settings1({ mqtt_id: v }) },
    rpc: { read: (c) => at(c, 'mqtt', 'client_id'), write: (v) => ({ method: 'MQTT.SetConfig', config: { client_id: v } }) },
  },
  {
    key: 'mqtt.topicPrefix',
    target: (s, ctx) => fill(s.mqtt?.topicPrefix, ctx),
    // Gen1 derives its topics from mqtt_id ("shellies/<mqtt_id>/..."), there is no prefix setting.
    rpc: { read: (c) => at(c, 'mqtt', 'topic_prefix'), write: (v) => ({ method: 'MQTT.SetConfig', config: { topic_prefix: v } }) },
  },
  // --- Cloud ------------------------------------------------------------------
  {
    key: 'cloud.enable',
    target: (s) => s.cloud?.enable,
    gen1: { read: (c) => at(c, 'cloud', 'enabled'), write: (v) => ({ path: '/settings/cloud', params: { enabled: v } }) },
    rpc: { read: (c) => at(c, 'cloud', 'enable'), write: (v) => ({ method: 'Cloud.SetConfig', config: { enable: v } }) },
  },
  // --- Device name ---------------------------------------------------------------
  // Checked for empty/too long results in planTemplate before sending.
  {
    key: 'device.name',
    target: (s, ctx) => (s.device?.name === undefined ? undefined : fillDeviceName(s.device.name, ctx)),
    gen1: { read: (c) => at(c, 'name'), write: (v) => settings1({ name: v }) },
    rpc: { read: (c) => at(c, 'sys', 'device', 'name'), write: (v) => ({ method: 'Sys.SetConfig', config: { device: { name: v } } }) },
  },
  // --- Time and location --------------------------------------------------------
  {
    key: 'time.sntpServer',
    target: (s) => s.time?.sntpServer,
    gen1: { read: (c) => at(c, 'sntp', 'server'), write: (v) => settings1({ sntp_server: v }) },
    rpc: { read: (c) => at(c, 'sys', 'sntp', 'server'), write: (v) => ({ method: 'Sys.SetConfig', config: { sntp: { server: v } } }) },
  },
  {
    key: 'time.timezone',
    target: (s) => s.time?.timezone,
    // A fixed timezone only sticks with auto detection off.
    gen1: { read: (c) => at(c, 'timezone'), write: (v) => settings1({ timezone: v, tzautodetect: false }) },
    rpc: { read: (c) => at(c, 'sys', 'location', 'tz'), write: (v) => ({ method: 'Sys.SetConfig', config: { location: { tz: v } } }) },
  },
  {
    key: 'time.lat',
    target: (s) => s.time?.lat,
    gen1: { read: (c) => at(c, 'lat'), write: (v) => settings1({ lat: v }) },
    rpc: { read: (c) => at(c, 'sys', 'location', 'lat'), write: (v) => ({ method: 'Sys.SetConfig', config: { location: { lat: v } } }) },
  },
  {
    key: 'time.lon',
    target: (s) => s.time?.lon,
    gen1: { read: (c) => at(c, 'lng'), write: (v) => settings1({ lng: v }) },
    rpc: { read: (c) => at(c, 'sys', 'location', 'lon'), write: (v) => ({ method: 'Sys.SetConfig', config: { location: { lon: v } } }) },
  },
  // --- Eco / LED -------------------------------------------------------------------
  {
    key: 'eco.ecoMode',
    target: (s) => s.eco?.ecoMode,
    // Gen1: no documented parameter, so not supported (AGENTS.md: do not guess).
    rpc: { read: (c) => at(c, 'sys', 'device', 'eco_mode'), write: (v) => ({ method: 'Sys.SetConfig', config: { device: { eco_mode: v } } }) },
  },
  {
    key: 'eco.ledStatusDisable',
    target: (s) => s.eco?.ledStatusDisable,
    gen1: { read: (c) => at(c, 'led_status_disable'), write: (v) => settings1({ led_status_disable: v }) },
  },
  // --- Bluetooth (Gen2+) -------------------------------------------------------------
  {
    key: 'bluetooth.enable',
    target: (s) => s.bluetooth?.enable,
    // Removed in firmware 2.0 (scanning is automatic); only applied where still present.
    rpc: { read: (c) => at(c, 'ble', 'enable'), write: (v) => ({ method: 'BLE.SetConfig', config: { enable: v } }) },
  },
  {
    key: 'bluetooth.rpc',
    target: (s) => s.bluetooth?.rpc,
    rpc: { read: (c) => at(c, 'ble', 'rpc', 'enable'), write: (v) => ({ method: 'BLE.SetConfig', config: { rpc: { enable: v } } }) },
  },
  {
    key: 'bluetooth.observer',
    target: (s) => s.bluetooth?.observer,
    rpc: { read: (c) => at(c, 'ble', 'observer', 'enable'), write: (v) => ({ method: 'BLE.SetConfig', config: { observer: { enable: v } } }) },
  },
  // --- WLAN access point (Gen2+) -------------------------------------------------------
  {
    key: 'wifiAp.enable',
    target: (s) => s.wifiAp?.enable,
    // Gen1 has AP *or* WLAN client: enabling the AP there would take the device off the network.
    rpc: { read: (c) => at(c, 'wifi', 'ap', 'enable'), write: (v) => ({ method: 'WiFi.SetConfig', config: { ap: { enable: v } } }) },
  },
  // --- AP roaming ------------------------------------------------------------------------
  {
    key: 'apRoaming.enable',
    target: (s) => s.apRoaming?.enable,
    gen1: { read: (c) => at(c, 'ap_roaming', 'enabled'), write: (v) => settings1({ ap_roaming_enabled: v }) },
    rpc: {
      // Gen2+: roaming is on while the scan interval is positive; 0 disables it.
      read: (c) => {
        const interval = at(c, 'wifi', 'roam', 'interval');
        return typeof interval === 'number' ? interval > 0 : undefined;
      },
      write: (v, c) => {
        const interval = at(c, 'wifi', 'roam', 'interval');
        const on = typeof interval === 'number' && interval > 0 ? interval : 60;
        return { method: 'WiFi.SetConfig', config: { roam: { interval: v ? on : 0 } } };
      },
    },
  },
  {
    key: 'apRoaming.threshold',
    target: (s) => s.apRoaming?.threshold,
    gen1: { read: (c) => at(c, 'ap_roaming', 'threshold'), write: (v) => settings1({ ap_roaming_threshold: v }) },
    rpc: { read: (c) => at(c, 'wifi', 'roam', 'rssi_thr'), write: (v) => ({ method: 'WiFi.SetConfig', config: { roam: { rssi_thr: v } } }) },
  },
  // --- CoIoT (Gen1) -------------------------------------------------------------------------
  {
    key: 'coiot.enable',
    target: (s) => s.coiot?.enable,
    gen1: { read: (c) => at(c, 'coiot', 'enabled'), write: (v) => settings1({ coiot_enable: v }) },
  },
  {
    key: 'coiot.updatePeriod',
    target: (s) => s.coiot?.updatePeriod,
    gen1: { read: (c) => at(c, 'coiot', 'update_period'), write: (v) => settings1({ coiot_update_period: v }) },
  },
  {
    key: 'coiot.peer',
    target: (s) => s.coiot?.peer,
    gen1: { read: (c) => at(c, 'coiot', 'peer'), write: (v) => settings1({ coiot_peer: v }) },
  },
];

/** All field keys, in display order (the UI has a label for each). */
export const TEMPLATE_FIELD_KEYS = [
  ...FIELDS.map((f) => f.key),
  'mqtt.password',
  'wifiAp.password',
  'script',
  ...(['sta', 'sta1'] as const).flatMap((i) => ['mode', 'ip', 'netmask', 'gateway', 'dns'].map((k) => `network.${i}.${k}`)),
];

interface WifiState {
  /** Interface in use: enabled and with an SSID. */
  configured: boolean;
  mode: unknown;
  ip: unknown;
  netmask: unknown;
  gateway: unknown;
  dns: unknown;
}

/**
 * Current WLAN client settings. Gen1 /settings: wifi_sta / wifi_sta1 with `ipv4_method`, `ip`,
 * `mask`, `gw`, `dns` (the write parameters are named netmask/gateway). Gen2+ Shelly.GetConfig:
 * wifi.sta / wifi.sta1 with `ipv4mode`, `ip`, `netmask`, `gw`, `nameserver`.
 */
function readWifi(gen: ShellyGen, cfg: Cfg, iface: WifiInterface): WifiState | undefined {
  const w = gen === 1 ? at(cfg, iface === 'sta' ? 'wifi_sta' : 'wifi_sta1') : at(cfg, 'wifi', iface);
  if (!isRecord(w)) return undefined;
  const enabled = gen === 1 ? w['enabled'] : w['enable'];
  return {
    configured: enabled === true && typeof w['ssid'] === 'string' && w['ssid'] !== '',
    mode: gen === 1 ? w['ipv4_method'] : w['ipv4mode'],
    ip: w['ip'] ?? null,
    netmask: (gen === 1 ? w['mask'] : w['netmask']) ?? null,
    gateway: w['gw'] ?? null,
    dns: (gen === 1 ? w['dns'] : w['nameserver']) ?? null,
  };
}

/** Current static IP of a WLAN interface (for keeping it on re-runs), or null. */
export function currentStaticIp(gen: ShellyGen, config: unknown, iface: WifiInterface): string | null {
  const w = readWifi(gen, isRecord(config) ? config : {}, iface);
  return w && w.mode === 'static' && typeof w.ip === 'string' ? w.ip : null;
}

function planNetwork(
  gen: ShellyGen,
  cfg: Cfg,
  iface: WifiInterface,
  n: NetworkSettings,
  settings: TemplateSettings,
  ctx: PlanContext,
  items: PlanItem[],
): NetworkChange | undefined {
  const key = (k: string) => `network.${iface}.${k}`;
  const cur = readWifi(gen, cfg, iface);
  if (!cur) {
    items.push({ key: key('mode'), status: 'unsupported', target: n.mode, reason: 'firmware' });
    return undefined;
  }
  if (!cur.configured) {
    items.push({ key: key('mode'), status: 'unsupported', current: cur.mode, target: n.mode, reason: 'inactive' });
    return undefined;
  }
  const path = iface === 'sta' ? '/settings/sta' : '/settings/sta1';

  if (n.mode === 'dhcp') {
    if (sameValue(cur.mode, 'dhcp')) {
      items.push({ key: key('mode'), status: 'same', current: cur.mode, target: 'dhcp' });
      return undefined;
    }
    items.push({ key: key('mode'), status: 'change', current: cur.mode, target: 'dhcp' });
    const step: ConfigStep =
      gen === 1
        ? { kind: 'gen1', path, params: { ipv4_method: 'dhcp' } }
        : { kind: 'rpc', method: 'WiFi.SetConfig', params: { config: { [iface]: { ipv4mode: 'dhcp' } } } };
    return { iface, step, mode: 'dhcp', ip: null };
  }

  const ip = ctx.assignedIps?.[iface];
  if (!ip) {
    items.push({ key: key('mode'), status: 'unsupported', current: cur.mode, target: 'static', reason: 'no_ip' });
    return undefined;
  }
  // Gen1 docs: a static config without gateway needs the cloud disabled first.
  const cloudOn = settings.cloud?.enable ?? at(cfg, 'cloud', 'enabled');
  if (gen === 1 && !n.gateway && cloudOn === true) {
    items.push({ key: key('mode'), status: 'unsupported', current: cur.mode, target: 'static', reason: 'gateway_cloud' });
    return undefined;
  }

  const wanted: [string, unknown, unknown][] = [
    ['mode', cur.mode, 'static'],
    ['ip', cur.ip, ip],
    ['netmask', cur.netmask, n.netmask],
    ...(n.gateway ? [['gateway', cur.gateway, n.gateway] as [string, unknown, unknown]] : []),
    ...(n.dns ? [['dns', cur.dns, n.dns] as [string, unknown, unknown]] : []),
  ];
  let changed = false;
  for (const [k, current, target] of wanted) {
    const same = sameValue(current, target);
    changed ||= !same;
    items.push({ key: key(k), status: same ? 'same' : 'change', current, target });
  }
  if (!changed) return undefined;

  // Only IP settings are sent; SSID and WLAN password stay untouched (Gen2 docs: pass is only
  // required together with ssid; Gen1 applies /settings/sta parameters individually).
  const step: ConfigStep =
    gen === 1
      ? {
          kind: 'gen1',
          path,
          params: {
            ipv4_method: 'static',
            ip,
            netmask: n.netmask ?? '',
            ...(n.gateway ? { gateway: n.gateway } : {}),
            ...(n.dns ? { dns: n.dns } : {}),
          },
        }
      : {
          kind: 'rpc',
          method: 'WiFi.SetConfig',
          params: {
            config: {
              [iface]: { ipv4mode: 'static', ip, netmask: n.netmask, ...(n.gateway ? { gw: n.gateway } : {}), ...(n.dns ? { nameserver: n.dns } : {}) },
            },
          },
        };
  return { iface, step, mode: 'static', ip };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  // Gen2 uses null for "default"; an empty string in the template never reaches here (minLength 1).
  return JSON.stringify(a) === JSON.stringify(b);
}

function deepMerge(target: Cfg, source: Cfg): Cfg {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    target[key] = isRecord(existing) && isRecord(value) ? deepMerge({ ...existing }, value) : value;
  }
  return target;
}

/** Gen1 query values: booleans as "true"/"false", numbers as decimal strings. */
function gen1Param(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function planTemplate(
  gen: ShellyGen,
  config: unknown,
  settings: TemplateSettings,
  ctx: PlanContext,
  secrets: TemplateSecrets = {},
): TemplatePlan {
  const cfg: Cfg = isRecord(config) ? config : {};
  const items: PlanItem[] = [];
  const gen1Steps = new Map<string, Record<string, unknown>>();
  const rpcSteps = new Map<string, Cfg>();

  const addGen1 = (step: { path: string; params: Record<string, unknown> }) =>
    gen1Steps.set(step.path, { ...(gen1Steps.get(step.path) ?? {}), ...step.params });
  const addRpc = (step: { method: string; config: Cfg }) =>
    rpcSteps.set(step.method, deepMerge(rpcSteps.get(step.method) ?? {}, step.config));

  for (const field of FIELDS) {
    const target = field.target(settings, ctx);
    if (target === undefined) continue;
    const mapping = gen === 1 ? field.gen1 : field.rpc;
    if (!mapping) {
      items.push({ key: field.key, status: 'unsupported', target, reason: 'generation' });
      continue;
    }
    const current = mapping.read(cfg);
    if (current === undefined) {
      items.push({ key: field.key, status: 'unsupported', target, reason: 'firmware' });
      continue;
    }
    if (sameValue(current, target)) {
      items.push({ key: field.key, status: 'same', current, target });
      continue;
    }
    if (field.key === 'device.name' && typeof target === 'string') {
      const reason = target === '' ? 'name_empty' : target.length > maxDeviceNameLength(gen) ? 'name_too_long' : undefined;
      if (reason) {
        items.push({ key: field.key, status: 'unsupported', current, target, reason });
        continue;
      }
    }
    // Since firmware 2.0 the device rejects enabling the AP without a password in the same call
    // (changelog 2.0.0: "AP password is only required when enabling the Access Point";
    // real device: "Invalid argument 'pass': should not be empty!"). The pass is added below.
    if (field.key === 'wifiAp.enable' && target === true && !secrets.apPassword) {
      items.push({ key: field.key, status: 'unsupported', current, target, reason: 'password' });
      continue;
    }
    items.push({ key: field.key, status: 'change', current, target });
    if (gen === 1) addGen1((mapping as Gen1Mapping).write(target, cfg));
    else addRpc((mapping as RpcMapping).write(target, cfg));
  }

  // Secrets: only when given at apply time. Write-only on the device, so they always count as a change.
  if (secrets.mqttPassword !== undefined && secrets.mqttPassword !== '') {
    if (at(cfg, 'mqtt') === undefined) {
      items.push({ key: 'mqtt.password', status: 'unsupported', target: SECRET_MASK, reason: 'firmware' });
    } else {
      items.push({ key: 'mqtt.password', status: 'change', current: SECRET_MASK, target: SECRET_MASK });
      if (gen === 1) addGen1(settings1({ mqtt_pass: secrets.mqttPassword }));
      else {
        // Gen2 docs: set `pass` together with `user`.
        const user = settings.mqtt?.user ?? at(cfg, 'mqtt', 'user');
        addRpc({ method: 'MQTT.SetConfig', config: { ...(typeof user === 'string' ? { user } : {}), pass: secrets.mqttPassword } });
      }
    }
  }
  if (secrets.apPassword !== undefined && secrets.apPassword !== '') {
    if (gen === 1 || at(cfg, 'wifi', 'ap') === undefined) {
      items.push({ key: 'wifiAp.password', status: 'unsupported', target: SECRET_MASK, reason: gen === 1 ? 'generation' : 'firmware' });
    } else {
      items.push({ key: 'wifiAp.password', status: 'change', current: SECRET_MASK, target: SECRET_MASK });
      // Only `pass`: whether `is_open` is writable is not documented; a set pass secures the AP.
      addRpc({ method: 'WiFi.SetConfig', config: { ap: { pass: secrets.apPassword } } });
    }
  }

  let script: ScriptPlan | undefined;
  if (settings.script) {
    const s = settings.script;
    if (gen === 1) {
      items.push({ key: 'script', status: 'unsupported', target: s.name, reason: 'generation' });
    } else {
      const existing = Object.entries(cfg).find(([key, value]) => key.startsWith('script:') && at(value, 'name') === s.name);
      // Whether the code differs is only known on the device, so a script always plans as a change.
      items.push({
        key: 'script',
        status: 'change',
        current: existing ? { name: s.name, enable: at(existing[1], 'enable') } : null,
        target: { name: s.name, ...(s.enable !== undefined ? { enable: s.enable } : {}), start: s.start ?? false },
      });
      script = { name: s.name, code: s.code, enable: s.enable, start: s.start ?? false };
    }
  }

  const network: NetworkChange[] = [];
  for (const iface of ['sta', 'sta1'] as const) {
    const n = settings.network?.[iface];
    if (!n) continue;
    const change = planNetwork(gen, cfg, iface, n, settings, ctx, items);
    if (change) network.push(change);
  }

  const steps: ConfigStep[] = [
    ...[...gen1Steps].map(([path, params]): ConfigStep => ({
      kind: 'gen1',
      path,
      params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, gen1Param(v)])),
    })),
    ...[...rpcSteps].map(([method, config]): ConfigStep => ({ kind: 'rpc', method, params: { config } })),
  ];
  return { items, steps, network, ...(script ? { script } : {}) };
}
