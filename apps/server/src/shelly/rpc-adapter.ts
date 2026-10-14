import { probeShelly } from './detect.js';
import { DigestSession, parseDigestChallenge } from './digest.js';
import { ShellyAuthError, ShellyHttpError, ShellyRpcError } from './errors.js';
import { deviceFetch, isRecord, readJson, stringOrNull } from './http.js';
import { DEFAULT_ADAPTER_TIMEOUT_MS, type AdapterOptions, type DeviceInfo, type ShellyAdapter } from './types.js';

// Gen2/Gen3/Gen4 JSON-RPC 2.0 over HTTP: POST /rpc.
// Auth is HTTP Digest, SHA-256, realm = device id, user always "admin".
// See https://shelly-api-docs.shelly.cloud/gen2/General/Authentication
const RPC_PATH = '/rpc';
const RPC_USER = 'admin';

export class RpcAdapter implements ShellyAdapter {
  private readonly timeoutMs: number;
  private readonly digest: DigestSession | undefined;
  private nextId = 1;

  constructor(
    readonly host: string,
    options: AdapterOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS;
    this.digest = options.credentials ? new DigestSession(RPC_USER, options.credentials.password) : undefined;
  }

  async getInfo(): Promise<DeviceInfo> {
    const info = await probeShelly(this.host, this.timeoutMs);
    if (info.name !== null || (info.authRequired && !this.digest)) return info;
    // Older firmware has no `name` in /shelly; it lives in sys.device.name.
    const sys = await this.call('Sys.GetConfig');
    const device = isRecord(sys) ? sys['device'] : undefined;
    return { ...info, name: isRecord(device) ? stringOrNull(device['name']) : null };
  }

  getConfig(): Promise<unknown> {
    return this.call('Shelly.GetConfig');
  }

  getStatus(): Promise<unknown> {
    return this.call('Shelly.GetStatus');
  }

  async reboot(): Promise<void> {
    await this.call('Shelly.Reboot');
  }

  async factoryReset(): Promise<void> {
    await this.call('Shelly.FactoryReset');
  }

  /** Sends one JSON-RPC request and returns `result`. Answers a digest challenge (or a stale nonce) once. */
  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify({ id: this.nextId++, src: 'shelly-manager', method, ...(params ? { params } : {}) });

    let { res, authenticated } = await this.post(body);
    // At most two retries: one for the initial challenge, one more if that nonce turns out stale.
    for (let attempt = 0; res.status === 401 && attempt < 2; attempt++) {
      const challenge = parseDigestChallenge(res.headers.get('www-authenticate'));
      await res.body?.cancel();
      if (!this.digest) throw new ShellyAuthError(this.host, 'required');
      // A new challenge in reply to an authenticated request means wrong credentials, unless the nonce was stale.
      if (!challenge || (authenticated && !challenge.stale)) throw new ShellyAuthError(this.host, 'invalid');
      this.digest.setChallenge(challenge);
      ({ res, authenticated } = await this.post(body));
    }
    if (res.status === 401) {
      await res.body?.cancel();
      throw new ShellyAuthError(this.host, this.digest ? 'invalid' : 'required');
    }

    if (!res.ok && res.status !== 400 && res.status !== 404 && res.status !== 500) {
      await res.body?.cancel();
      throw new ShellyHttpError(this.host, res.status, `${method} on ${this.host} failed: HTTP ${res.status}`);
    }

    const payload = await readJson(this.host, res, this.timeoutMs);
    if (!isRecord(payload)) throw new ShellyHttpError(this.host, res.status, `${method}: unexpected RPC frame`);
    const error = payload['error'];
    if (isRecord(error)) {
      const code = typeof error['code'] === 'number' ? error['code'] : -1;
      if (code === 401) throw new ShellyAuthError(this.host, this.digest ? 'invalid' : 'required');
      throw new ShellyRpcError(this.host, method, code, String(error['message'] ?? 'unknown error'));
    }
    if (!res.ok) throw new ShellyHttpError(this.host, res.status, `${method} on ${this.host} failed: HTTP ${res.status}`);
    // Reboot/FactoryReset answer `result: null`, which is a success.
    return payload['result'] ?? null;
  }

  private async post(body: string): Promise<{ res: Response; authenticated: boolean }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Reuses the last challenge (nonce + increasing nc) so authenticated devices need one round trip per call.
    const authorization = this.digest?.authorize('POST', RPC_PATH);
    if (authorization) headers['Authorization'] = authorization;
    const res = await deviceFetch(this.host, { method: 'POST', path: RPC_PATH, headers, body, timeoutMs: this.timeoutMs });
    return { res, authenticated: authorization !== undefined };
  }
}
