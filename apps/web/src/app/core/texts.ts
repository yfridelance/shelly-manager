import type { DeviceErrorCode, DeviceState, ScanStatus } from './api.types';

export const SCAN_STATUS_TEXT: Record<ScanStatus, string> = {
  running: 'Läuft',
  done: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

export const DEVICE_STATE_TEXT: Record<DeviceState, string> = {
  active: 'Aktiv',
  missing: 'Vermisst',
  reset: 'Zurückgesetzt',
};

/** Error codes of device actions: device errors plus checks done before contacting the device. */
export const ACTION_ERROR_TEXT: Record<string, string> = {
  not_found: 'Gerät nicht im Inventar',
  no_ip: 'Keine IP-Adresse bekannt',
  mac_mismatch: 'Unter dieser IP antwortet ein anderes Gerät. Bitte neu scannen.',
};

export function errorText(code: string | null | undefined): string {
  if (!code) return 'Fehler';
  return DEVICE_ERROR_TEXT[code as DeviceErrorCode] ?? ACTION_ERROR_TEXT[code] ?? code;
}

export const DEVICE_ERROR_TEXT: Record<DeviceErrorCode, string> = {
  auth_required: 'Zugangsdaten erforderlich',
  auth_invalid: 'Zugangsdaten falsch',
  timeout: 'Zeitüberschreitung',
  network: 'Nicht erreichbar',
  not_shelly: 'Kein Shelly',
  http: 'HTTP-Fehler',
  rpc: 'Gerätefehler',
  internal: 'Interner Fehler',
};

/** "A8032AB12345" -> "A8:03:2A:B1:23:45" */
export function formatMac(mac: string): string {
  return mac.match(/.{2}/g)?.join(':') ?? mac;
}

/**
 * Short firmware version from "<build date>/<version>-g<hash>":
 * "20241011-114455/1.4.4-g6d2a586" -> "1.4.4", "20230913-112003/v1.14.0-gcb84623" -> "v1.14.0".
 */
export function shortFirmware(fw: string | null): string {
  if (!fw) return '–';
  const version = fw.includes('/') ? fw.slice(fw.indexOf('/') + 1) : fw;
  return version.replace(/-g[0-9a-f]+$/, '');
}

export function ipSortKey(ip: string | null): number {
  if (!ip) return Number.MAX_SAFE_INTEGER;
  return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
}
