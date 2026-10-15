import { NotAShellyError, ShellyHttpError } from './errors.js';
import { deviceFetch, isRecord, readJson, stringOrNull } from './http.js';
import { normalizeMac } from './mac.js';
import type { DeviceInfo, ShellyGen } from './types.js';

export const DEFAULT_PROBE_TIMEOUT_MS = 1500;

/**
 * Interprets the answer of `GET /shelly`.
 * Gen2+ answers carry a numeric `gen`; Gen1 answers have none and are recognized by `type` + `mac`.
 * Returns undefined if the payload does not look like a Shelly device.
 */
export function parseShellyInfo(raw: unknown): DeviceInfo | undefined {
  if (!isRecord(raw) || typeof raw['mac'] !== 'string') return undefined;
  let mac: string;
  try {
    mac = normalizeMac(raw['mac']);
  } catch {
    return undefined;
  }

  if ('gen' in raw) {
    const gen = raw['gen'];
    if (gen !== 2 && gen !== 3 && gen !== 4) return undefined;
    return {
      mac,
      gen: gen as ShellyGen,
      model: stringOrNull(raw['model']),
      app: stringOrNull(raw['app']),
      firmware: stringOrNull(raw['fw_id']) ?? stringOrNull(raw['ver']),
      // Present on newer firmware only; RpcAdapter.getInfo() falls back to Sys.GetConfig.
      name: stringOrNull(raw['name']),
      deviceId: stringOrNull(raw['id']),
      authRequired: raw['auth_en'] === true,
      raw,
    };
  }

  if (typeof raw['type'] !== 'string') return undefined;
  return {
    mac,
    gen: 1,
    model: stringOrNull(raw['type']),
    app: null,
    firmware: stringOrNull(raw['fw']),
    // Gen1 exposes the name only in /settings, see Gen1Adapter.getInfo().
    name: null,
    // Gen1 /shelly has no id; the hostname comes from /settings, see Gen1Adapter.getInfo().
    deviceId: null,
    authRequired: raw['auth'] === true,
    raw,
  };
}

/** `GET /shelly` needs no auth on any generation. Throws NotAShellyError for other HTTP servers. */
export async function probeShelly(
  host: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<DeviceInfo> {
  const res = await deviceFetch(host, { path: '/shelly', timeoutMs, signal });
  if (!res.ok) {
    await res.body?.cancel();
    throw new NotAShellyError(host, `${host} answered /shelly with HTTP ${res.status}`);
  }
  let raw: unknown;
  try {
    raw = await readJson(host, res, timeoutMs);
  } catch (err) {
    if (err instanceof ShellyHttpError) throw new NotAShellyError(host, `${host} answered /shelly without JSON`);
    throw err;
  }
  const info = parseShellyInfo(raw);
  if (!info) throw new NotAShellyError(host, `${host} answered /shelly, but not like a Shelly device`);
  return info;
}
