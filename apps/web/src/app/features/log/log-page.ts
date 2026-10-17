import { Component, computed, inject, signal } from '@angular/core';
import { SiteService } from '../../core/site.service';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { ActionEntry } from '../../core/api.types';
import { actionDetail, actionLabel } from '../../core/action-text';
import { ACTION_TEXT, errorText, formatMac } from '../../core/texts';

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

  private readonly site = inject(SiteService);
  protected readonly entries = httpResource<ActionEntry[]>(() => `/api/actions?limit=2000&site=${this.site.siteId()}`, { defaultValue: [] });
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

  protected readonly actionLabel = actionLabel;
  protected readonly detailText = actionDetail;

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
