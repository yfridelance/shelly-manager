import { probeShelly } from './detect.js';
import { DigestSession, parseDigestChallenge } from './digest.js';
import { ShellyAuthError, ShellyHttpError, ShellyRpcError } from './errors.js';
import { deviceFetch, isRecord, readJson, stringOrNull } from './http.js';
import { parseRpcUpdates } from './firmware.js';
import {
  DEFAULT_ADAPTER_TIMEOUT_MS,
  type AdapterOptions,
  type ConfigStep,
  type DeviceInfo,
  type FirmwareChannel,
  type FirmwareUpdates,
  type ShellyAdapter,
} from './types.js';

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

  async checkForUpdate(): Promise<FirmwareUpdates> {
    return parseRpcUpdates(await this.call('Shelly.CheckForUpdate'));
  }

  async startUpdate(channel: FirmwareChannel): Promise<void> {
    // Shelly.Update takes either `stage` or `url`; we only use the official channels.
    await this.call('Shelly.Update', { stage: channel });
  }

  async applyConfig(step: ConfigStep): Promise<{ restartRequired: boolean }> {
    if (step.kind !== 'rpc') throw new Error(`RPC device cannot run ${step.kind} step`);
    const result = await this.call(step.method, step.params);
    return { restartRequired: isRecord(result) && result['restart_required'] === true };
  }

  /**
   * Creates or updates a script by name (Script.List/Create/Stop/PutCode/SetConfig/Start).
   * Code is uploaded in 1024 byte chunks, as the official tooling does; the device's code is
   * compared first so unchanged scripts are not touched.
   */
  async deployScript(name: string, code: string, enable: boolean | undefined, start: boolean): Promise<ScriptDeployResult> {
    const list = await this.call('Script.List');
    const scripts = isRecord(list) && Array.isArray(list['scripts']) ? list['scripts'] : [];
    const existing = scripts.find((s): s is Record<string, unknown> => isRecord(s) && s['name'] === name);

    let id: number;
    let created = false;
    let running = false;
    let currentEnable: unknown;
    if (existing && typeof existing['id'] === 'number') {
      id = existing['id'];
      running = existing['running'] === true;
      currentEnable = existing['enable'];
    } else {
      const res = await this.call('Script.Create', { name });
      if (!isRecord(res) || typeof res['id'] !== 'number') throw new ShellyHttpError(this.host, 200, 'Script.Create: no id');
      id = res['id'];
      created = true;
      currentEnable = false;
    }

    const codeChanged = created || (await this.readScriptCode(id)) !== code;
    if (codeChanged) {
      // PutCode fails on a running script.
      if (running) {
        await this.call('Script.Stop', { id });
        running = false;
      }
      const CHUNK = 1024;
      for (let offset = 0; offset < code.length; offset += CHUNK) {
        await this.call('Script.PutCode', { id, code: code.slice(offset, offset + CHUNK), append: offset > 0 });
      }
    }

    const enableChanged = enable !== undefined && currentEnable !== enable;
    if (enableChanged) await this.call('Script.SetConfig', { id, config: { enable } });

    let started = false;
    if (start && (!running || codeChanged)) {
      await this.call('Script.Start', { id });
      started = true;
    }
    return { id, created, codeChanged, enableChanged, started };
  }

  private async readScriptCode(id: number): Promise<string> {
    let code = '';
    for (let guard = 0; guard < 1000; guard++) {
      const res = await this.call('Script.GetCode', { id, offset: code.length });
      if (!isRecord(res) || typeof res['data'] !== 'string') break;
      code += res['data'];
      if (!(typeof res['left'] === 'number' && res['left'] > 0) || res['data'] === '') break;
    }
    return code;
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

export interface ScriptDeployResult {
  id: number;
  created: boolean;
  codeChanged: boolean;
  enableChanged: boolean;
  started: boolean;
}
