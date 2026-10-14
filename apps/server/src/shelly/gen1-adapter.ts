import { probeShelly } from './detect.js';
import { ShellyAuthError, ShellyHttpError } from './errors.js';
import { deviceFetch, isRecord, readJson, stringOrNull } from './http.js';
import { DEFAULT_ADAPTER_TIMEOUT_MS, type AdapterOptions, type DeviceInfo, type ShellyAdapter } from './types.js';

// Gen1 REST API, see https://shelly-api-docs.shelly.cloud/gen1/
// Auth is HTTP Basic (plain text over HTTP) for everything except /shelly.
export class Gen1Adapter implements ShellyAdapter {
  private readonly timeoutMs: number;
  private readonly authHeader: string | undefined;

  constructor(
    readonly host: string,
    options: AdapterOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS;
    const c = options.credentials;
    this.authHeader = c
      ? `Basic ${Buffer.from(`${c.username ?? 'admin'}:${c.password}`, 'utf8').toString('base64')}`
      : undefined;
  }

  async getInfo(): Promise<DeviceInfo> {
    const info = await probeShelly(this.host, this.timeoutMs);
    if (info.authRequired && !this.authHeader) return info;
    const settings = await this.get('/settings');
    return { ...info, name: isRecord(settings) ? stringOrNull(settings['name']) : null };
  }

  getConfig(): Promise<unknown> {
    return this.get('/settings');
  }

  getStatus(): Promise<unknown> {
    return this.get('/status');
  }

  async reboot(): Promise<void> {
    await this.get('/reboot');
  }

  async factoryReset(): Promise<void> {
    // There is no /reset endpoint on Gen1: the `reset` parameter of /settings
    // "will perform a factory reset of the device" (official Gen1 docs, /settings).
    await this.get('/settings?reset=true');
  }

  private async get(path: string): Promise<unknown> {
    const res = await deviceFetch(this.host, {
      path,
      headers: this.authHeader ? { Authorization: this.authHeader } : {},
      timeoutMs: this.timeoutMs,
    });
    if (res.status === 401) {
      await res.body?.cancel();
      throw new ShellyAuthError(this.host, this.authHeader ? 'invalid' : 'required');
    }
    if (!res.ok) {
      // Gen1 errors are 4xx with a text/plain body.
      const text = (await res.text().catch(() => '')).slice(0, 200);
      throw new ShellyHttpError(this.host, res.status, `GET ${path} on ${this.host} failed: HTTP ${res.status} ${text}`.trim());
    }
    return readJson(this.host, res, this.timeoutMs);
  }
}
