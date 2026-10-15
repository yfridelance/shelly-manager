import type { IncomingMessage, ServerResponse } from 'node:http';
import { deepMerge, sendJson, sendText, type DeviceHandler, type Gen1Spec, type MockDeviceState } from './types.js';

type Kind = 'bool' | 'num' | 'str';

/** Writable /settings parameters (official Gen1 docs) -> path in the /settings answer. */
const SETTINGS_PARAMS: Record<string, { path: string[]; kind: Kind }> = {
  mqtt_enable: { path: ['mqtt', 'enable'], kind: 'bool' },
  mqtt_server: { path: ['mqtt', 'server'], kind: 'str' },
  mqtt_user: { path: ['mqtt', 'user'], kind: 'str' },
  mqtt_id: { path: ['mqtt', 'id'], kind: 'str' },
  coiot_enable: { path: ['coiot', 'enabled'], kind: 'bool' },
  coiot_update_period: { path: ['coiot', 'update_period'], kind: 'num' },
  coiot_peer: { path: ['coiot', 'peer'], kind: 'str' },
  sntp_server: { path: ['sntp', 'server'], kind: 'str' },
  timezone: { path: ['timezone'], kind: 'str' },
  tzautodetect: { path: ['tzautodetect'], kind: 'bool' },
  lat: { path: ['lat'], kind: 'num' },
  lng: { path: ['lng'], kind: 'num' },
  led_status_disable: { path: ['led_status_disable'], kind: 'bool' },
  ap_roaming_enabled: { path: ['ap_roaming', 'enabled'], kind: 'bool' },
  ap_roaming_threshold: { path: ['ap_roaming', 'threshold'], kind: 'num' },
};

function parseValue(raw: string, kind: Kind): unknown {
  if (kind === 'bool') return raw === 'true' || raw === '1';
  if (kind === 'num') return Number(raw);
  return raw;
}

function nested(path: string[], value: unknown): Record<string, unknown> {
  return path.reduceRight<Record<string, unknown>>((acc, key, i) => (i === path.length - 1 ? { [key]: value } : { [key]: acc }), {});
}

const DEFAULT_FW = '20230913-112003/v1.14.0-gcb84623';

/** Emulates a Gen1 device (REST + optional Basic auth), modelled on a Shelly 1 (SHSW-1). */
export class Gen1Device implements DeviceHandler {
  resetPending = false;
  private name: string | null;
  private auth: { username: string; password: string } | undefined;
  private wifiConfigured = true;
  private uptime = 4711;
  private fw: string;
  /** Values written via /settings, merged over the defaults. */
  private overrides: Record<string, unknown> = {};
  private updates: { stable?: string | undefined; beta?: string | undefined };

  constructor(
    private readonly spec: Gen1Spec,
    private readonly state: MockDeviceState,
  ) {
    this.name = spec.name ?? null;
    this.auth = spec.auth;
    this.fw = spec.fw ?? DEFAULT_FW;
    this.updates = { ...spec.updates };
  }

  private get suffix(): string {
    return this.spec.mac.slice(-6);
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://mock');
    // Log parameter names only: values may be secrets (mqtt_pass).
    const keys = [...url.searchParams.keys()];
    const shownQuery = url.pathname === '/settings' && keys.some((k) => k !== 'reset' && k !== 'name') ? `?${keys.join('&')}` : url.search;
    this.state.requests.push(`${req.method} ${url.pathname}${shownQuery}`);

    if (url.pathname === '/shelly') {
      // /shelly never requires auth.
      sendJson(res, 200, {
        type: this.spec.type,
        mac: this.spec.mac,
        auth: this.auth !== undefined,
        fw: this.fw,
        discoverable: false,
        longid: 1,
      });
      return;
    }

    if (!this.authorized(req)) {
      this.state.authFailures++;
      sendText(res, 401, '401 Unauthorized', { 'WWW-Authenticate': `Basic realm="shelly1-${this.suffix}"` });
      return;
    }

    if (this.spec.failing?.includes(url.pathname)) {
      sendText(res, 500, 'Internal error');
      return;
    }

    switch (url.pathname) {
      case '/settings': {
        if (url.searchParams.has('reset')) {
          this.factoryReset();
          if (this.spec.dropConnectionOnReset) {
            res.destroy();
            return;
          }
          sendJson(res, 200, this.settings());
          return;
        }
        for (const [key, raw] of url.searchParams) {
          if (key === 'name') this.name = raw || null;
          else if (key === 'mqtt_pass') this.state.secretsReceived['mqtt_pass'] = raw;
          else if (SETTINGS_PARAMS[key]) {
            const { path, kind } = SETTINGS_PARAMS[key];
            this.overrides = deepMerge(this.overrides, nested(path, parseValue(raw, kind)));
          } else {
            // Strict on purpose: unknown parameters reveal planner bugs in tests.
            sendText(res, 400, `Unknown parameter ${key}`);
            return;
          }
        }
        sendJson(res, 200, this.settings());
        return;
      }
      case '/settings/cloud':
        if (url.searchParams.has('enabled')) {
          this.overrides = deepMerge(this.overrides, { cloud: { enabled: parseValue(url.searchParams.get('enabled') ?? '', 'bool') } });
        }
        sendJson(res, 200, (this.settings() as { cloud: unknown }).cloud);
        return;
      case '/status':
        sendJson(res, 200, this.status());
        return;
      case '/ota/check':
        sendJson(res, 200, { status: 'ok' });
        return;
      case '/ota': {
        const channel = url.searchParams.has('beta') ? 'beta' : url.searchParams.has('update') ? 'stable' : undefined;
        const target = channel ? this.updates[channel] : undefined;
        if (channel && target) {
          // Real devices download, flash and reboot; the mock applies the new firmware at once.
          this.state.updateCount++;
          this.fw = target;
          this.updates = {};
          this.uptime = 0;
          sendJson(res, 200, { ...this.ota(), status: 'updating' });
          return;
        }
        sendJson(res, 200, this.ota());
        return;
      }
      case '/reboot':
        this.state.rebootCount++;
        this.uptime = 0;
        sendJson(res, 200, {});
        return;
      default:
        sendText(res, 404, 'Not Found');
    }
  }

  private authorized(req: IncomingMessage): boolean {
    if (!this.auth) return true;
    const header = req.headers.authorization ?? '';
    const match = /^Basic\s+(.+)$/i.exec(header);
    if (!match?.[1]) return false;
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    return decoded === `${this.auth.username}:${this.auth.password}`;
  }

  private factoryReset(): void {
    this.state.factoryResetCount++;
    this.name = null;
    this.auth = undefined;
    this.wifiConfigured = false;
    this.overrides = {};
    this.resetPending = true;
  }

  private ota(): Record<string, unknown> {
    return {
      status: 'idle',
      has_update: this.updates.stable !== undefined,
      new_version: this.updates.stable ?? this.fw,
      old_version: this.fw,
      ...(this.updates.beta ? { beta_version: this.updates.beta } : {}),
    };
  }

  private settings(): Record<string, unknown> {
    return deepMerge(this.baseSettings(), this.overrides);
  }

  private baseSettings(): Record<string, unknown> {
    const hostname = `shelly1-${this.suffix}`;
    return {
      device: { type: this.spec.type, mac: this.spec.mac, hostname, num_outputs: 1 },
      wifi_ap: { enabled: !this.wifiConfigured, ssid: hostname, key: '' },
      wifi_sta: { enabled: this.wifiConfigured, ssid: this.wifiConfigured ? 'Haus' : null, ipv4_method: 'dhcp', ip: null, gw: null, mask: null, dns: null },
      wifi_sta1: { enabled: false, ssid: null, ipv4_method: 'dhcp', ip: null, gw: null, mask: null, dns: null },
      ap_roaming: { enabled: false, threshold: -70 },
      mqtt: { enable: false, server: '192.168.33.3:1883', user: '', id: hostname, reconnect_timeout_max: 60, reconnect_timeout_min: 2, clean_session: true, keep_alive: 60, max_qos: 0, retain: false, update_period: 30 },
      coiot: { enabled: true, update_period: 15, peer: '' },
      sntp: { server: 'time.google.com', enabled: true },
      login: { enabled: this.auth !== undefined, unprotected: false, username: this.auth?.username ?? 'admin' },
      pin_code: '',
      name: this.name,
      fw: this.fw,
      discoverable: false,
      build_info: { build_id: (this.fw).split('/')[1] ?? '', build_timestamp: '2023-09-13T11:20:03Z', build_version: '1.0' },
      cloud: { enabled: this.wifiConfigured, connected: false },
      timezone: 'Europe/Zurich',
      lat: 47.3769,
      lng: 8.5417,
      tzautodetect: true,
      tz_utc_offset: 7200,
      tz_dst: false,
      tz_dst_auto: true,
      time: '12:34',
      unixtime: 1760445240,
      led_status_disable: false,
      debug_enable: false,
      allow_cross_origin: false,
      relays: [
        { name: null, appliance_type: 'General', ison: false, has_timer: false, default_state: 'off', btn_type: 'toggle', btn_reverse: 0, auto_on: 0, auto_off: 0, power: 0, schedule: false, schedule_rules: [] },
      ],
      eco_mode_enabled: true,
    };
  }

  private status(): Record<string, unknown> {
    return {
      wifi_sta: { connected: this.wifiConfigured, ssid: this.wifiConfigured ? 'Haus' : '', ip: '127.0.0.1', rssi: -61 },
      cloud: { enabled: this.wifiConfigured, connected: false },
      mqtt: { connected: false },
      time: '12:34',
      unixtime: 1760445240,
      serial: 1,
      has_update: false,
      mac: this.spec.mac,
      cfg_changed_cnt: 0,
      actions_stats: { skipped: 0 },
      relays: [{ ison: false, has_timer: false, timer_started: 0, timer_duration: 0, timer_remaining: 0, source: 'input' }],
      meters: [{ power: 0, is_valid: true }],
      inputs: [{ input: 0, event: '', event_cnt: 0 }],
      update: this.ota(),
      ram_total: 51688,
      ram_free: 39304,
      fs_size: 233681,
      fs_free: 150851,
      uptime: this.uptime,
    };
  }
}
