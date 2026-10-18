import type { Device } from './api.types';

/**
 * Name built from floor, location and kind («EG Küche Licht»); empty parts are skipped.
 * If another device of the site already has that name, it is numbered («Keller Licht 2»).
 * null when floor, location and kind are all empty.
 */
export function suggestDeviceName(device: Pick<Device, 'mac' | 'floor' | 'location' | 'kind'>, siteDevices: readonly Device[]): string | null {
  const base = [device.floor, device.location, device.kind]
    .map((p) => p?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  if (!base) return null;
  const taken = new Set(siteDevices.filter((d) => d.mac !== device.mac && d.name).map((d) => d.name?.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}
