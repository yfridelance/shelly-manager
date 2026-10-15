import { isRecord, stringOrNull } from './http.js';
import type { FirmwareUpdates, ShellyGen } from './types.js';

/**
 * Reads available updates from a raw status answer, so every scan/snapshot knows about them
 * without extra requests.
 * Gen1: `update: { has_update, new_version, beta_version }` (see /ota in the Gen1 docs).
 * Gen2+: `sys.available_updates: { stable?: { version }, beta?: { version } }`.
 * Returns undefined if the status does not carry the information.
 */
export function updatesFromStatus(gen: ShellyGen, status: unknown): FirmwareUpdates | undefined {
  if (!isRecord(status)) return undefined;
  if (gen === 1) {
    const update = status['update'];
    return isRecord(update) ? parseGen1Ota(update) : undefined;
  }
  const sys = status['sys'];
  if (!isRecord(sys) || !isRecord(sys['available_updates'])) return undefined;
  return parseRpcUpdates(sys['available_updates']);
}

/** `/ota` and `status.update` of Gen1. new_version equals the current one when has_update is false. */
export function parseGen1Ota(ota: Record<string, unknown>): FirmwareUpdates {
  return {
    stable: ota['has_update'] === true ? stringOrNull(ota['new_version']) : null,
    beta: stringOrNull(ota['beta_version']),
  };
}

/** Result of `Shelly.CheckForUpdate` or `sys.available_updates`: empty object = no update. */
export function parseRpcUpdates(result: unknown): FirmwareUpdates {
  const version = (channel: string): string | null => {
    const entry = isRecord(result) ? result[channel] : undefined;
    return isRecord(entry) ? stringOrNull(entry['version']) : null;
  };
  return { stable: version('stable'), beta: version('beta') };
}
