import { Component, computed, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { ActionEntry } from '../../core/api.types';
import { itemText } from '../../core/template-fields';
import { ACTION_TEXT, UNCONFIRMED_RESET_TEXT, errorText, formatMac, shortFirmware } from '../../core/texts';

@Component({
  selector: 'app-log-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './log-page.html',
  styleUrl: './log-page.scss',
})
export class LogPage {
  protected readonly actionText = ACTION_TEXT;
  protected readonly actionTypes = Object.keys(ACTION_TEXT);
  protected readonly formatMac = formatMac;
  protected readonly errorText = errorText;

  protected readonly entries = httpResource<ActionEntry[]>(() => '/api/actions?limit=2000', { defaultValue: [] });
  protected readonly action = signal('');
  protected readonly result = signal('');
  protected readonly search = signal('');

  protected readonly filtered = computed(() => {
    const action = this.action();
    const result = this.result();
    const search = this.search().trim().toLowerCase();
    return this.entries.value().filter(
      (e) =>
        (!action || e.action === action) &&
        (!result || e.result === result) &&
        (!search || [e.deviceName, e.mac, formatMac(e.mac), e.requestedBy].some((v) => v?.toLowerCase().includes(search))),
    );
  });

  protected duration(e: ActionEntry): string {
    if (!e.finishedAt) return '';
    const ms = Date.parse(e.finishedAt) - Date.parse(e.requestedAt);
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  }

  protected detailText(e: ActionEntry): string {
    const d = e.details;
    if (!d) return '';
    const parts: string[] = [];
    if (e.action === 'firmware_update' && d.channel) {
      const channel = d.channel === 'beta' ? 'Beta' : 'Stabil';
      parts.push(d.to ? `${shortFirmware(d.from ?? null)} → ${shortFirmware(d.to)} (${channel})` : `Kanal ${channel}`);
    }
    if (e.action === 'apply_template') {
      parts.push(`«${d.templateName ?? '?'}»`);
      const changes = d.changes ?? [];
      if (changes.length > 0) {
        parts.push(changes.map((c) => itemText({ key: c.key, status: 'change', current: c.from, target: c.to })).join('; '));
      } else if (e.result === 'ok') {
        parts.push('keine Änderung nötig');
      }
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

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
