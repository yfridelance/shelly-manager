import type { ActionEntry } from './api.types';
import { t } from './i18n/i18n';
import { itemText } from './template-fields';
import { actionTypeText, errorText, shortFirmware } from './texts';

/** "Template «Haus-Standard»", "Firmware-Update", "Werksreset", … */
export function actionLabel(e: ActionEntry): string {
  if (e.action === 'apply_template' && e.details?.templateName) return t('action.templateNamed', { name: e.details.templateName });
  return actionTypeText(e.action);
}

/** Factory reset whose command broke off, but the device was gone when probed again. */
export function unconfirmedResetText(): string {
  return t('action.unconfirmedReset');
}

/** Short outcome for compact lists, e.g. "2 geändert, neu gestartet" or "1.4.4 → 1.5.0". Empty if nothing to add. */
export function actionSummary(e: ActionEntry): string {
  const d = e.details;
  if (e.result === 'error') return errorText(e.errorCode);
  if (!d || e.result !== 'ok') return '';
  if (e.action === 'apply_template') {
    const n = d.changes?.length ?? 0;
    const parts = [n === 0 ? t('action.noChangeNeeded') : t('action.changedCount', { count: n })];
    if (d.ipChange) parts.push(ipChangeText(d.ipChange));
    if (d.rebooted) parts.push(t('action.rebooted'));
    else if (d.restartRequired) parts.push(t('action.restartRequired'));
    return parts.join(', ');
  }
  if (e.action === 'rename' && d.to) return t('action.renamed', { from: d.from ?? '–', to: d.to });
  if (e.action === 'firmware_update' && d.to) return `${shortFirmware(d.from ?? null)} → ${shortFirmware(d.to)}`;
  if (e.action === 'factory_reset' && d.confirmed === false) return t('action.probablySuccessful');
  return '';
}

/** Full detail text for the log (template name is part of the label). */
export function actionDetail(e: ActionEntry): string {
  const d = e.details;
  if (!d) return '';
  const parts: string[] = [];
  if (e.action === 'firmware_update' && d.channel) {
    const channel = d.channel === 'beta' ? t('action.channelBeta') : t('action.channelStable');
    parts.push(
      d.to
        ? `${shortFirmware(d.from ?? null)} → ${shortFirmware(d.to)} (${channel})`
        : t('action.channel', { channel }),
    );
  }
  if (e.action === 'rename' && d.to) parts.push(t('action.renamed', { from: d.from ?? '–', to: d.to }));
  if (e.action === 'apply_template') {
    const changes = d.changes ?? [];
    if (changes.length > 0) {
      parts.push(changes.map((c) => itemText({ key: c.key, status: 'change', current: c.from, target: c.to })).join('; '));
    } else if (e.result === 'ok') {
      parts.push(t('action.noChangeNeeded'));
    }
    if (d.ipChange) parts.push(ipChangeText(d.ipChange));
    if (d.rebooted) parts.push(t('action.rebooted'));
    else if (d.restartRequired) parts.push(t('action.restartRequired'));
    if (d.appliedSteps && d.appliedSteps.length > 0) parts.push(t('action.appliedSteps', { steps: d.appliedSteps.join(', ') }));
  }
  if (d.confirmed === false) {
    parts.push(d.recheck === 'auth_disabled' ? t('action.unconfirmedResetAuthRemoved') : unconfirmedResetText());
  }
  if (d.snapshotSkipped) parts.push(t('action.withoutSnapshot', { reason: errorText(d.snapshotError) }));
  else if (d.snapshotId !== undefined) parts.push(t('action.snapshotBefore', { id: d.snapshotId }));
  else if (d.snapshotError) parts.push(t('action.snapshotError', { reason: errorText(d.snapshotError) }));
  return parts.join(' · ');
}

/** "IP 192.168.10.11 → 192.168.10.50", with a hint when the device was not found again. */
export function ipChangeText(c: { from: string | null; to: string | null; confirmed: boolean; dhcp?: boolean }): string {
  if (c.dhcp && !c.confirmed) return t('action.dhcpUnknown');
  if (c.dhcp) return t('action.dhcpSame', { ip: c.from });
  const text = `IP ${c.from ?? '–'} → ${c.to}`;
  return c.confirmed ? text : t('action.ipUnreachable', { text });
}
