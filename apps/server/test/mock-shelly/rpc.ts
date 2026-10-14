import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, type DeviceHandler, type MockDeviceState, type RpcSpec } from './types.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * Emulates a Gen2+ device (JSON-RPC over POST /rpc, optional Digest SHA-256 auth),
 * modelled on a Shelly Plus 1PM. Digest verification is written independently of src/shelly/digest.ts.
 */
export class RpcDevice implements DeviceHandler {
  resetPending = false;
  private name: string | null;
  private password: string | undefined;
  private wifiConfigured = true;
  private uptime = 81234;
  /** nonce -> highest nc seen (firmware >= 2.0 rejects nc that does not increase). */
  private readonly nonces = new Map<string, number>();
  readonly id: string;

  constructor(
    private readonly spec: RpcSpec,
    private readonly state: MockDeviceState,
  ) {
    this.name = spec.name ?? null;
    this.password = spec.password;
    this.id = spec.id ?? `${spec.app.toLowerCase()}-${spec.mac.toLowerCase()}`;
  }

  /** Forget all nonces; the next authenticated request gets a `stale=true` challenge. */
  expireNonces(): void {
    this.nonces.clear();
  }

  handle(req: IncomingMessage, res: ServerResponse, body: string): void {
    const url = new URL(req.url ?? '/', 'http://mock');

    if (url.pathname === '/shelly' && req.method === 'GET') {
      this.state.requests.push('GET /shelly');
      sendJson(res, 200, this.deviceInfo(!this.spec.legacyShellyEndpoint));
      return;
    }
    if (url.pathname !== '/rpc' || req.method !== 'POST') {
      this.state.requests.push(`${req.method} ${url.pathname}`);
      sendJson(res, 404, { code: 404, message: 'Not Found' });
      return;
    }

    let frame: { id?: unknown; method?: unknown; params?: unknown };
    try {
      frame = JSON.parse(body) as typeof frame;
    } catch {
      sendJson(res, 400, { id: null, src: this.id, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const id = frame.id ?? null;
    const method = typeof frame.method === 'string' ? frame.method : '';
    this.state.requests.push(`RPC ${method}`);

    if (this.password !== undefined) {
      const verdict = this.checkDigest(req.headers.authorization);
      if (verdict !== 'ok') {
        this.state.authFailures++;
        const nonce = this.newNonce();
        const challenge = `Digest qop="auth", realm="${this.id}", nonce="${nonce}", algorithm=SHA-256${verdict === 'stale' ? ', stale=true' : ''}`;
        sendJson(
          res,
          401,
          { id, src: this.id, error: { code: 401, message: JSON.stringify({ auth_type: 'digest', nonce, realm: this.id, algorithm: 'SHA-256' }) } },
          { 'WWW-Authenticate': challenge },
        );
        return;
      }
    }

    if (this.spec.failing?.includes(method)) {
      sendJson(res, 500, { id, src: this.id, error: { code: -103, message: `${method} failed: internal error` } });
      return;
    }

    const reply = (result: unknown): void => sendJson(res, 200, { id, src: this.id, result });
    switch (method) {
      case 'Shelly.GetDeviceInfo':
        return reply(this.deviceInfo(true));
      case 'Shelly.GetConfig':
        return reply(this.config());
      case 'Shelly.GetStatus':
        return reply(this.status());
      case 'Sys.GetConfig':
        return reply(this.config()['sys']);
      case 'Shelly.Reboot':
        this.state.rebootCount++;
        this.uptime = 0;
        return reply(null);
      case 'Shelly.FactoryReset':
        this.state.factoryResetCount++;
        this.name = null;
        this.password = undefined;
        this.wifiConfigured = false;
        this.nonces.clear();
        this.resetPending = true;
        return reply(null);
      default:
        sendJson(res, 404, { id, src: this.id, error: { code: 404, message: `No handler for ${method}` } });
    }
  }

  private newNonce(): string {
    const nonce = randomBytes(12).toString('base64');
    this.nonces.set(nonce, 0);
    return nonce;
  }

  private checkDigest(header: string | undefined): 'ok' | 'missing' | 'invalid' | 'stale' {
    if (!header?.startsWith('Digest ')) return 'missing';
    const p: Record<string, string> = {};
    for (const m of header.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) {
      if (m[1]) p[m[1]] = m[2] ?? m[3] ?? '';
    }
    const { username, realm, nonce, uri, nc, cnonce, qop, response, algorithm } = p;
    if (!nonce || !nc || !cnonce || !response || !uri) return 'invalid';
    if (username !== 'admin' || realm !== this.id || qop !== 'auth' || algorithm !== 'SHA-256') return 'invalid';

    const lastNc = this.nonces.get(nonce);
    const ha1 = sha256(`admin:${this.id}:${this.password}`);
    const expected = sha256(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${sha256(`POST:${uri}`)}`);
    if (expected !== response) return 'invalid';
    if (lastNc === undefined) return 'stale'; // right password, unknown/expired nonce
    const ncValue = Number.parseInt(nc, 16);
    if (!(ncValue > lastNc)) return 'invalid';
    this.nonces.set(nonce, ncValue);
    return 'ok';
  }

  private fwId(): string {
    return this.spec.fwId ?? '20241011-114455/1.4.4-g6d2a586';
  }

  private deviceInfo(withName: boolean): Record<string, unknown> {
    return {
      ...(withName ? { name: this.name } : {}),
      id: this.id,
      mac: this.spec.mac,
      slot: 0,
      model: this.spec.model,
      gen: this.spec.gen,
      fw_id: this.fwId(),
      ver: this.spec.ver ?? '1.4.4',
      app: this.spec.app,
      auth_en: this.password !== undefined,
      auth_domain: this.password !== undefined ? this.id : null,
    };
  }

  private config(): Record<string, unknown> {
    return {
      ble: { enable: true, rpc: { enable: true }, observer: { enable: false } },
      cloud: { enable: this.wifiConfigured, server: 'shelly-103-eu.shelly.cloud:6022/jrpc' },
      'input:0': { id: 0, name: null, type: 'switch', enable: true, invert: false, factory_reset: true },
      knx: { enable: false, ia: '15.15.255', routing: { addr: '224.0.23.12:3671' } },
      mqtt: { enable: false, server: null, client_id: this.id, user: null, ssl_ca: null, topic_prefix: this.id, rpc_ntf: true, status_ntf: false, use_client_cert: false, enable_rpc: true, enable_control: true },
      'switch:0': { id: 0, name: null, in_mode: 'follow', initial_state: 'match_input', auto_on: false, auto_on_delay: 60, auto_off: false, auto_off_delay: 60, power_limit: 4480, voltage_limit: 280, autorecover_voltage_errors: false, current_limit: 16 },
      sys: {
        device: { name: this.name, mac: this.spec.mac, fw_id: this.fwId(), discoverable: true, eco_mode: false },
        location: { tz: 'Europe/Zurich', lat: 47.3769, lon: 8.5417 },
        debug: { level: 2, file_level: null, mqtt: { enable: false }, websocket: { enable: false }, udp: { addr: null } },
        ui_data: {},
        rpc_udp: { dst_addr: null, listen_port: null },
        sntp: { server: 'time.google.com' },
        cfg_rev: 12,
      },
      wifi: {
        ap: { ssid: `${this.id}`, is_open: true, enable: !this.wifiConfigured, range_extender: { enable: false } },
        sta: { ssid: this.wifiConfigured ? 'Haus' : null, is_open: false, enable: this.wifiConfigured, ipv4mode: 'dhcp', ip: null, netmask: null, gw: null, nameserver: null },
        sta1: { ssid: null, is_open: true, enable: false, ipv4mode: 'dhcp', ip: null, netmask: null, gw: null, nameserver: null },
        roam: { rssi_thr: -80, interval: 60 },
      },
      ws: { enable: false, server: null, ssl_ca: 'ca.pem' },
    };
  }

  private status(): Record<string, unknown> {
    return {
      ble: {},
      cloud: { connected: false },
      'input:0': { id: 0, state: false },
      mqtt: { connected: false },
      'switch:0': { id: 0, source: 'init', output: false, apower: 0, voltage: 231.4, freq: 50, current: 0, aenergy: { total: 1234.567, by_minute: [0, 0, 0], minute_ts: 1760445240 }, temperature: { tC: 41.2, tF: 106.2 } },
      sys: { mac: this.spec.mac, restart_required: false, time: '12:34', unixtime: 1760445240, uptime: this.uptime, ram_size: 260000, ram_free: 140000, fs_size: 458752, fs_free: 135168, cfg_rev: 12, kvs_rev: 0, schedule_rev: 0, webhook_rev: 0, available_updates: {}, reset_reason: 3 },
      wifi: { sta_ip: this.wifiConfigured ? '127.0.0.1' : null, status: this.wifiConfigured ? 'got ip' : 'disconnected', ssid: this.wifiConfigured ? 'Haus' : null, rssi: -58 },
      ws: { connected: false },
    };
  }
}
