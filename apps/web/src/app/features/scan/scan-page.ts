import { Component, computed, effect, inject, signal } from '@angular/core';
import { SiteService } from '../../core/site.service';
import { DatePipe } from '@angular/common';
import type { ScanDeviceResult } from '../../core/api.types';
import { DEVICE_ERROR_TEXT, SCAN_STATUS_TEXT, formatMac, ipSortKey } from '../../core/texts';
import { ScanService } from './scan.service';

@Component({
  selector: 'app-scan-page',
  imports: [DatePipe],
  templateUrl: './scan-page.html',
  styleUrl: './scan-page.scss',
})
export class ScanPage {
  protected readonly scans = inject(ScanService);
  protected readonly site = inject(SiteService);
  protected readonly statusText = SCAN_STATUS_TEXT;
  protected readonly formatMac = formatMac;

  protected readonly range = signal('');
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
      this.range().trim(),
      this.site.siteId(),
      password ? { password, ...(username && username !== 'admin' ? { username } : {}) } : undefined,
    );
  }

  protected snapshotText(d: ScanDeviceResult): string {
    if (d.snapshot === 'ok') return 'Config gelesen';
    if (d.snapshot === 'auth_required') return 'Zugangsdaten nötig';
    if (d.snapshot === 'foreign') return `gehört zu Standort «${d.foreignSite?.name ?? '?'}», unverändert`;
    return d.errorCode ? DEVICE_ERROR_TEXT[d.errorCode] : 'Fehler';
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
