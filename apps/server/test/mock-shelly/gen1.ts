import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendText, type DeviceHandler, type Gen1Spec, type MockDeviceState } from './types.js';

const DEFAULT_FW = '20230913-112003/v1.14.0-gcb84623';

/** Emulates a Gen1 device (REST + optional Basic auth), modelled on a Shelly 1 (SHSW-1). */
export class Gen1Device implements DeviceHandler {
  resetPending = false;
  private name: string | null;
  private auth: { username: string; password: string } | undefined;
  private wifiConfigured = true;
  private uptime = 4711;

  constructor(
    private readonly spec: Gen1Spec,
    private readonly state: MockDeviceState,
  ) {
    this.name = spec.name ?? null;
    this.auth = spec.auth;
  }

  private get suffix(): string {
    return this.spec.mac.slice(-6);
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://mock');
    this.state.requests.push(`${req.method} ${url.pathname}${url.search}`);

    if (url.pathname === '/shelly') {
      // /shelly never requires auth.
      sendJson(res, 200, {
        type: this.spec.type,
        mac: this.spec.mac,
        auth: this.auth !== undefined,
        fw: this.spec.fw ?? DEFAULT_FW,
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

    switch (url.pathname) {
      case '/settings':
        if (url.searchParams.has('reset')) {
          this.factoryReset();
        } else if (url.searchParams.has('name')) {
          this.name = url.searchParams.get('name') || null;
        }
        sendJson(res, 200, this.settings());
        return;
      case '/status':
        sendJson(res, 200, this.status());
        return;
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
    this.resetPending = true;
  }

  private settings(): Record<string, unknown> {
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
      fw: this.spec.fw ?? DEFAULT_FW,
      discoverable: false,
      build_info: { build_id: (this.spec.fw ?? DEFAULT_FW).split('/')[1] ?? '', build_timestamp: '2023-09-13T11:20:03Z', build_version: '1.0' },
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
      update: { status: 'idle', has_update: false, new_version: this.spec.fw ?? DEFAULT_FW, old_version: this.spec.fw ?? DEFAULT_FW },
      ram_total: 51688,
      ram_free: 39304,
      fs_size: 233681,
      fs_free: 150851,
      uptime: this.uptime,
    };
  }
}
