import type { DeviceFunctions, DeviceState, ScanStatus } from './api.types';
import { t, translate, translateOptional } from './i18n/i18n';

export function scanStatusText(s: ScanStatus): string {
  return t(`scanStatus.${s}`);
}

export const DEVICE_STATES: readonly DeviceState[] = ['active', 'missing', 'reset'];

export function deviceStateText(s: DeviceState): string {
  return t(`deviceState.${s}`);
}

/**
 * Text for an error code of the API: device errors, checks done before contacting the device and
 * input errors. The UI never shows the server's `message` (German, not translated); unknown codes
 * get a generic text with the code.
 */
export function errorText(code: string | null | undefined): string {
  if (!code) return t('errors.generic');
  return translateOptional(`errors.${code}`) ?? t('errors.unknown', { code });
}

/** Action types of the log, in the order of the filter. */
export const ACTION_TYPES = ['snapshot', 'reboot', 'factory_reset', 'firmware_update', 'apply_template'] as const;

export function actionTypeText(action: string): string {
  return translateOptional(`actionType.${action}`) ?? action;
}

/** "2× Schalter · Messung"; same wording as the CSV export (server reads the same locale files). */
export function functionsText(f: DeviceFunctions | null): string {
  if (!f) return '';
  const n = (count: number, label: string): string[] =>
    count === 0 ? [] : [count > 1 ? translate('functions.count', { count, label }) : label];
  const outputs = f.switch + f.cover + f.light;
  const parts = [
    ...n(f.cover, t('functions.cover')),
    ...n(f.switch, t('functions.switch')),
    ...n(f.light, t('functions.light')),
    ...(f.meter > 0 ? [t('functions.meter')] : []),
    ...n(f.sensor, t('functions.sensor')),
    // Inputs only describe the device when it has nothing else (i3, Plus i4).
    ...(outputs + f.meter + f.sensor === 0 ? n(f.input, t('functions.input')) : []),
  ];
  if (f.metering && f.meter === 0) parts.push(t('functions.metering'));
  return parts.join(' · ');
}

/** Inventory filter by function; "unknown" = config not read yet. */
export type FunctionFilter = 'switch' | 'cover' | 'light' | 'meter' | 'sensor' | 'input' | 'metering' | 'unknown';

export const FUNCTION_FILTERS: readonly FunctionFilter[] = ['switch', 'cover', 'light', 'meter', 'sensor', 'input', 'metering', 'unknown'];

export function functionFilterText(f: FunctionFilter): string {
  return t(`functionFilter.${f}`);
}

export function matchesFunction(f: DeviceFunctions | null, filter: FunctionFilter): boolean {
  if (filter === 'unknown') return f === null;
  if (!f) return false;
  if (filter === 'metering') return f.metering;
  if (filter === 'input') return f.input > 0 && f.switch + f.cover + f.light + f.meter + f.sensor === 0;
  return f[filter] > 0;
}

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
