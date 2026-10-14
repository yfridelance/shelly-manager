import type { DeviceErrorCode, ScanStatus } from './api.types';

export const SCAN_STATUS_TEXT: Record<ScanStatus, string> = {
  running: 'Läuft',
  done: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

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
