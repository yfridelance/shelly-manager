import type { ActionEntry } from './api.types';
import { itemText } from './template-fields';
import { ACTION_TEXT, UNCONFIRMED_RESET_TEXT, errorText, shortFirmware } from './texts';

/** "Template «Haus-Standard»", "Firmware-Update", "Werksreset", … */
export function actionLabel(e: ActionEntry): string {
  const base = ACTION_TEXT[e.action] ?? e.action;
  if (e.action === 'apply_template' && e.details?.templateName) return `${base} «${e.details.templateName}»`;
  return base;
}

/** Short outcome for compact lists, e.g. "2 geändert, neu gestartet" or "1.4.4 → 1.5.0". Empty if nothing to add. */
export function actionSummary(e: ActionEntry): string {
  const d = e.details;
  if (e.result === 'error') return errorText(e.errorCode);
  if (!d || e.result !== 'ok') return '';
  if (e.action === 'apply_template') {
    const n = d.changes?.length ?? 0;
    const parts = [n === 0 ? 'keine Änderung nötig' : `${n} geändert`];
    if (d.ipChange) parts.push(ipChangeText(d.ipChange));
    if (d.rebooted) parts.push('neu gestartet');
    else if (d.restartRequired) parts.push('Neustart nötig');
    return parts.join(', ');
  }
  if (e.action === 'firmware_update' && d.to) return `${shortFirmware(d.from ?? null)} → ${shortFirmware(d.to)}`;
  if (e.action === 'factory_reset' && d.confirmed === false) return 'vermutlich erfolgreich';
  return '';
}

/** Full detail text for the log (template name is part of the label). */
export function actionDetail(e: ActionEntry): string {
  const d = e.details;
  if (!d) return '';
  const parts: string[] = [];
  if (e.action === 'firmware_update' && d.channel) {
    const channel = d.channel === 'beta' ? 'Beta' : 'Stabil';
    parts.push(d.to ? `${shortFirmware(d.from ?? null)} → ${shortFirmware(d.to)} (${channel})` : `Kanal ${channel}`);
  }
  if (e.action === 'apply_template') {
    const changes = d.changes ?? [];
    if (changes.length > 0) {
      parts.push(changes.map((c) => itemText({ key: c.key, status: 'change', current: c.from, target: c.to })).join('; '));
    } else if (e.result === 'ok') {
      parts.push('keine Änderung nötig');
    }
    if (d.ipChange) parts.push(ipChangeText(d.ipChange));
    if (d.rebooted) parts.push('neu gestartet');
    else if (d.restartRequired) parts.push('Neustart nötig');
    if (d.appliedSteps && d.appliedSteps.length > 0) parts.push(`bereits ausgeführt: ${d.appliedSteps.join(', ')}`);
  }
  if (d.confirmed === false) {
    parts.push(d.recheck === 'auth_disabled' ? 'Reset vermutlich erfolgreich – Passwortschutz entfernt' : UNCONFIRMED_RESET_TEXT);
  }
  if (d.snapshotSkipped) parts.push(`ohne Snapshot (Override, ${errorText(d.snapshotError)})`);
  else if (d.snapshotId !== undefined) parts.push(`Config vorher gesichert (Snapshot ${d.snapshotId})`);
  else if (d.snapshotError) parts.push(`Snapshot: ${errorText(d.snapshotError)}`);
  return parts.join(' · ');
}

/** "IP 192.168.10.11 → 192.168.10.50", with a hint when the device was not found again. */
export function ipChangeText(c: { from: string | null; to: string | null; confirmed: boolean; dhcp?: boolean }): string {
  if (c.dhcp && !c.confirmed) return 'auf DHCP umgestellt, neue IP unbekannt – bitte neu scannen';
  if (c.dhcp) return `auf DHCP umgestellt, weiterhin unter ${c.from}`;
  const text = `IP ${c.from ?? '–'} → ${c.to}`;
  return c.confirmed ? text : `${text} (dort nicht erreichbar – bitte neu scannen)`;
}
