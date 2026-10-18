import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { deepMerge, sendJson, type DeviceHandler, type MockDeviceState, type RpcSpec } from './types.js';

/** Component SetConfig methods and the config key they write. */
const SET_CONFIG: Record<string, string> = {
  'Sys.SetConfig': 'sys',
  'MQTT.SetConfig': 'mqtt',
  'Cloud.SetConfig': 'cloud',
  'BLE.SetConfig': 'ble',
  'WiFi.SetConfig': 'wifi',
};

/** Write-only keys accepted although they never appear in GetConfig. */
const WRITE_ONLY: Record<string, string[][]> = { mqtt: [['pass']], wifi: [['ap', 'pass']] };

interface MockScript {
  id: number;
  name: string;
  enable: boolean;
  running: boolean;
  code: string;
}

/** Every key of `patch` must already exist in `base` (or be write-only), like a real device validates. */
function unknownKey(base: unknown, patch: Record<string, unknown>, writeOnly: string[][], path: string[] = []): string | undefined {
  for (const [key, value] of Object.entries(patch)) {
    const here = [...path, key];
    if (writeOnly.some((w) => w.join('.') === here.join('.'))) continue;
    const baseValue = typeof base === 'object' && base !== null ? (base as Record<string, unknown>)[key] : undefined;
    if (baseValue === undefined) return here.join('.');
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof baseValue === 'object' && baseValue !== null) {
      const nestedKey = unknownKey(baseValue, value as Record<string, unknown>, writeOnly, here);
      if (nestedKey) return nestedKey;
    }
  }
  return undefined;
}

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
  private ver: string;
  private fwIdValue: string;
  private updates: NonNullable<RpcSpec['updates']>;
  /** Values written via <Component>.SetConfig, merged over the defaults. */
  private overrides: Record<string, unknown> = {};
  readonly scripts: MockScript[] = [];
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
    this.ver = spec.ver ?? '1.4.4';
    this.fwIdValue = spec.fwId ?? '20241011-114455/1.4.4-g6d2a586';
    this.updates = { ...spec.updates };
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

    const component = SET_CONFIG[method];
    if (component) {
      const patch = ((frame.params ?? {}) as { config?: Record<string, unknown> }).config ?? {};
      const bad = unknownKey(this.config()[component], patch, WRITE_ONLY[component] ?? []);
      if (bad) {
        sendJson(res, 400, { id, src: this.id, error: { code: -103, message: `Invalid argument '${component}.${bad}'` } });
        return;
      }
      // Like firmware >= 2.0: enabling the AP needs a password in the same call.
      const apPatch = component === 'wifi' ? (patch['ap'] as Record<string, unknown> | undefined) : undefined;
      const apNow = (this.config()['wifi'] as { ap?: { enable?: boolean } } | undefined)?.ap;
      if (apPatch?.['enable'] === true && apNow?.enable !== true && typeof apPatch['pass'] !== 'string') {
        sendJson(res, 400, { id, src: this.id, error: { code: -103, message: "Invalid argument 'pass': should not be empty!" } });
        return;
      }
      const clean = structuredClone(patch);
      if (component === 'mqtt' && typeof clean['pass'] === 'string') {
        this.state.secretsReceived['mqtt.pass'] = clean['pass'];
        delete clean['pass'];
      }
      // The name is reported by /shelly and Sys.GetConfig alike, so it lives outside the overrides.
      const dev = component === 'sys' ? (clean['device'] as Record<string, unknown> | undefined) : undefined;
      if (dev && 'name' in dev) {
        this.name = typeof dev['name'] === 'string' && dev['name'] !== '' ? dev['name'] : null;
        delete dev['name'];
      }
      const ap = (clean['ap'] ?? undefined) as Record<string, unknown> | undefined;
      if (component === 'wifi' && ap && typeof ap['pass'] === 'string') {
        this.state.secretsReceived['wifi.ap.pass'] = ap['pass'];
        delete ap['pass'];
      }
      this.overrides = deepMerge(this.overrides, { [component]: clean });
      if (component === 'wifi') {
        for (const iface of ['sta', 'sta1'] as const) {
          const p = clean[iface] as Record<string, unknown> | undefined;
          if (p && ('ipv4mode' in p || 'ip' in p)) {
            const now = ((this.config()['wifi'] as Record<string, Record<string, unknown>>)[iface]) ?? {};
            // Reply first, then "reconnect" (real devices reconnect about a second later).
            res.on('finish', () => this.spec.onIpChange?.(iface, now['ipv4mode'] === 'static' ? String(now['ip']) : null));
          }
        }
      }
      // MQTT changes need a reboot (official docs); the others apply at runtime.
      return reply({ restart_required: component === 'mqtt' });
    }

    switch (method) {
      case 'Shelly.GetDeviceInfo':
        return reply(this.deviceInfo(true));
      case 'Shelly.GetConfig':
        return reply(this.config());
      case 'Shelly.GetStatus':
        return reply(this.status());
      case 'Sys.GetConfig':
        return reply(this.config()['sys']);
      case 'Script.List':
        return reply({ scripts: this.scripts.map(({ id: sid, name, enable, running }) => ({ id: sid, name, enable, running })) });
      case 'Script.Create': {
        const name = String((frame.params as { name?: string } | undefined)?.name ?? `script_${this.scripts.length + 1}`);
        const sid = this.scripts.reduce((max, s) => Math.max(max, s.id), 0) + 1;
        this.scripts.push({ id: sid, name, enable: false, running: false, code: '' });
        return reply({ id: sid });
      }
      case 'Script.PutCode':
      case 'Script.GetCode':
      case 'Script.SetConfig':
      case 'Script.Start':
      case 'Script.Stop': {
        const p = (frame.params ?? {}) as { id?: number; code?: string; append?: boolean; offset?: number; config?: { enable?: boolean } };
        const script = this.scripts.find((s) => s.id === p.id);
        if (!script) {
          sendJson(res, 404, { id, src: this.id, error: { code: -105, message: `Argument 'id', value ${p.id} not found!` } });
          return;
        }
        if (method === 'Script.PutCode') {
          if (script.running && !p.append) {
            sendJson(res, 400, { id, src: this.id, error: { code: -103, message: 'Script is running' } });
            return;
          }
          script.code = p.append ? script.code + (p.code ?? '') : (p.code ?? '');
          return reply({ len: script.code.length });
        }
        if (method === 'Script.GetCode') {
          // Small pages to exercise the paging in the client.
          const offset = p.offset ?? 0;
          const data = script.code.slice(offset, offset + 700);
          return reply({ data, left: Math.max(0, script.code.length - offset - data.length) });
        }
        if (method === 'Script.SetConfig') {
          if (p.config?.enable !== undefined) script.enable = p.config.enable;
          return reply({ restart_required: false });
        }
        const wasRunning = script.running;
        script.running = method === 'Script.Start';
        return reply({ was_running: wasRunning });
      }
      case 'Shelly.CheckForUpdate':
        return reply(this.availableUpdates(true));
      case 'Shelly.Update': {
        const params = (frame.params ?? {}) as { stage?: string };
        const target = params.stage === 'beta' ? this.updates.beta : this.updates.stable;
        if (!target) {
          sendJson(res, 400, { id, src: this.id, error: { code: -114, message: 'No update info' } });
          return;
        }
        // Real devices download, flash and reboot; the mock applies the new firmware at once.
        this.state.updateCount++;
        this.ver = target.version;
        this.fwIdValue = target.buildId;
        this.updates = {};
        this.uptime = 0;
        return reply(null);
      }
      case 'Shelly.Reboot':
        this.state.rebootCount++;
        this.uptime = 0;
        return reply(null);
      case 'Shelly.FactoryReset':
        this.state.factoryResetCount++;
        this.name = null;
        this.password = undefined;
        this.wifiConfigured = false;
        this.overrides = {};
        this.scripts.length = 0;
        this.nonces.clear();
        this.resetPending = true;
        if (this.spec.dropConnectionOnReset) {
          res.destroy();
          return;
        }
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
    return this.fwIdValue;
  }

  /** Same shape for Shelly.CheckForUpdate and sys.available_updates. */
  private availableUpdates(withBuildId: boolean): Record<string, unknown> {
    const entry = (u: { version: string; buildId: string }) => (withBuildId ? { version: u.version, build_id: u.buildId } : { version: u.version });
    return {
      ...(this.updates.stable ? { stable: entry(this.updates.stable) } : {}),
      ...(this.updates.beta ? { beta: entry(this.updates.beta) } : {}),
    };
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
      ver: this.ver,
      app: this.spec.app,
      auth_en: this.password !== undefined,
      auth_domain: this.password !== undefined ? this.id : null,
    };
  }

  private config(): Record<string, unknown> {
    const scripts = Object.fromEntries(this.scripts.map((s) => [`script:${s.id}`, { id: s.id, name: s.name, enable: s.enable }]));
    return deepMerge({ ...this.baseConfig(), ...scripts }, this.overrides);
  }

  private baseConfig(): Record<string, unknown> {
    return {
      ble: { enable: true, rpc: { enable: true }, observer: { enable: false } },
      cloud: { enable: this.wifiConfigured, server: 'shelly-103-eu.shelly.cloud:6022/jrpc' },
      'input:0': { id: 0, name: null, type: 'switch', enable: true, invert: false, factory_reset: true },
      knx: { enable: false, ia: '15.15.255', routing: { addr: '224.0.23.12:3671' } },
      mqtt: { enable: false, server: null, client_id: this.id, user: null, ssl_ca: null, topic_prefix: this.id, rpc_ntf: true, status_ntf: false, use_client_cert: false, enable_rpc: true, enable_control: true },
      ...this.outputConfig(),
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

  /** Switch or cover components (device profile), like the real models. */
  private outputConfig(): Record<string, unknown> {
    if (this.spec.profile === 'cover') {
      return { 'cover:0': { id: 0, name: null, motor: { idle_power_thr: 2 }, maxtime_open: 60, maxtime_close: 60, initial_state: 'stopped', invert_directions: false, in_mode: 'dual', swap_inputs: false, power_limit: 4480, voltage_limit: 280, current_limit: 10 } };
    }
    return Object.fromEntries(
      Array.from({ length: this.spec.switches ?? 1 }, (_, id) => [
        `switch:${id}`,
        { id, name: null, in_mode: 'follow', initial_state: 'match_input', auto_on: false, auto_on_delay: 60, auto_off: false, auto_off_delay: 60, power_limit: 4480, voltage_limit: 280, autorecover_voltage_errors: false, current_limit: 16 },
      ]),
    );
  }

  /** Only metering models report apower/aenergy (official Gen2 docs). */
  private outputStatus(): Record<string, unknown> {
    const metering = this.spec.metering !== false;
    const power = metering ? { apower: 0, voltage: 231.4, freq: 50, current: 0, aenergy: { total: 1234.567, by_minute: [0, 0, 0], minute_ts: 1760445240 } } : {};
    if (this.spec.profile === 'cover') {
      return { 'cover:0': { id: 0, source: 'init', state: 'stopped', ...power, pos_control: true, current_pos: 100, temperature: { tC: 41.2, tF: 106.2 } } };
    }
    return Object.fromEntries(
      Array.from({ length: this.spec.switches ?? 1 }, (_, id) => [`switch:${id}`, { id, source: 'init', output: false, ...power, temperature: { tC: 41.2, tF: 106.2 } }]),
    );
  }

  private status(): Record<string, unknown> {
    return {
      ble: {},
      cloud: { connected: false },
      'input:0': { id: 0, state: false },
      mqtt: { connected: false },
      ...this.outputStatus(),
      sys: { mac: this.spec.mac, restart_required: false, time: '12:34', unixtime: 1760445240, uptime: this.uptime, ram_size: 260000, ram_free: 140000, fs_size: 458752, fs_free: 135168, cfg_rev: 12, kvs_rev: 0, schedule_rev: 0, webhook_rev: 0, available_updates: this.availableUpdates(false), reset_reason: 3 },
      wifi: { sta_ip: this.wifiConfigured ? '127.0.0.1' : null, status: this.wifiConfigured ? 'got ip' : 'disconnected', ssid: this.wifiConfigured ? 'Haus' : null, rssi: -58 },
      ws: { connected: false },
    };
  }
}
