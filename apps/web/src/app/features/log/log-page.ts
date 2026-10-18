import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject, signal } from '@angular/core';
import { SiteService } from '../../core/site.service';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { ActionEntry } from '../../core/api.types';
import { actionDetail, actionLabel } from '../../core/action-text';
import { formatNumber } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import { ACTION_TYPES, actionTypeText, errorText, formatMac } from '../../core/texts';
import { kernValue } from '../../core/kern';

@Component({
  selector: 'app-log-page',
  imports: [DateTimePipe, TranslatePipe, RouterLink],
  templateUrl: './log-page.html',
  styleUrl: './log-page.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class LogPage {
  protected readonly actionText = actionTypeText;
  protected readonly actionTypes = ACTION_TYPES;
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
    return ms < 1000 ? `${ms} ms` : `${formatNumber(ms / 1000, 1)} s`;
  }

  protected readonly actionLabel = actionLabel;
  protected readonly detailText = actionDetail;

  protected readonly value = kernValue;
}
