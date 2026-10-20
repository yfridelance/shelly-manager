import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, effect, inject, signal } from '@angular/core';
import { SiteService } from '../../core/site.service';
import type { ScanDeviceResult, ScanSummary } from '../../core/api.types';
import { kernValue, normalizeIp } from '../../core/kern';
import { currentLocale, t } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import { errorText, formatMac, ipSortKey, scanStatusText } from '../../core/texts';
import { ScanService } from './scan.service';

@Component({
  selector: 'app-scan-page',
  imports: [DateTimePipe, TranslatePipe],
  templateUrl: './scan-page.html',
  styleUrl: './scan-page.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ScanPage {
  protected readonly scans = inject(ScanService);
  protected readonly site = inject(SiteService);
  protected readonly statusText = scanStatusText;
  protected readonly formatMac = formatMac;

  protected readonly range = signal('');
  /** Same limit as the server (MAX_SCAN_ADDRESSES); the server checks again. */
  protected readonly maxAddresses = 1024;
  protected readonly locale = currentLocale;
  protected readonly username = signal('admin');
  // Cleared right after the scan has been started: no longer in memory than needed.
  protected readonly password = signal('');

  protected readonly scan = this.scans.current;
  protected readonly running = computed(() => this.scan()?.status === 'running');
  protected readonly devices = computed(() =>
    [...(this.scan()?.devices ?? [])].sort((a, b) => ipSortKey(a.ip) - ipSortKey(b.ip)),
  );

  constructor() {
    // Each site has its own scans: show the newest one of the current site.
    effect(() => {
      void this.scans.resume(this.site.siteId());
    });
  }

  protected async start(event: Event): Promise<void> {
    event.preventDefault();
    const password = this.password();
    this.password.set('');
    const username = this.username().trim();
    await this.scans.start(
      normalizeIp(this.range()),
      this.site.siteId(),
      password ? { password, ...(username && username !== 'admin' ? { username } : {}) } : undefined,
    );
  }

  protected snapshotText(d: ScanDeviceResult): string {
    if (d.snapshot === 'ok') return t('scan.configRead');
    if (d.snapshot === 'auth_required') return t('scan.credentialsNeeded');
    if (d.snapshot === 'foreign') return t('scan.foreign', { site: d.foreignSite?.name ?? '?' });
    return errorText(d.errorCode);
  }

  protected readonly value = kernValue;

  protected statusTone(status: ScanSummary['status']): 'ok' | 'warn' | 'danger' | 'busy' {
    return status === 'done' ? 'ok' : status === 'failed' ? 'danger' : status === 'cancelled' ? 'warn' : 'busy';
  }
}
