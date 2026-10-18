import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ScanDetails, ScanDeviceResult, ScanSummary } from '../../core/api.types';
import { toDeviceApiError } from '../../core/devices-api';

export interface ScanCredentials {
  username?: string;
  password: string;
}

const POLL_INTERVAL_MS = 1000;

/** Holds the current scan across navigation. Live updates via SSE, falling back to polling. */
@Injectable({ providedIn: 'root' })
export class ScanService {
  private readonly http = inject(HttpClient);
  private events: EventSource | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  readonly current = signal<ScanDetails | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  /** Re-attaches to the newest scan of this site (e.g. after a reload or a site switch). */
  async resume(siteId: number): Promise<void> {
    if (this.current()?.siteId === siteId) return;
    this.stopFollowing();
    this.current.set(null);
    const scans = await firstValueFrom(this.http.get<ScanSummary[]>(`/api/scans?site=${siteId}`)).catch(() => []);
    const latest = scans[0];
    if (latest) {
      this.current.set({ ...latest, devices: [] });
      this.follow(latest.id);
    }
  }

  async start(range: string, siteId: number, credentials?: ScanCredentials): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const summary = await firstValueFrom(
        this.http.post<ScanSummary>('/api/scans', { range, siteId, ...(credentials ? { credentials } : {}) }),
      );
      this.current.set({ ...summary, devices: [] });
      this.follow(summary.id);
    } catch (err) {
      this.error.set(messageOf(err));
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(): Promise<void> {
    const scan = this.current();
    if (!scan || scan.status !== 'running') return;
    try {
      await firstValueFrom(this.http.delete<ScanSummary>(`/api/scans/${scan.id}`));
    } catch (err) {
      this.error.set(messageOf(err));
    }
  }

  private follow(id: string): void {
    this.stopFollowing();
    if (typeof EventSource === 'undefined') {
      this.poll(id);
      return;
    }
    const es = new EventSource(`/api/scans/${id}/events`);
    this.events = es;
    es.addEventListener('snapshot', (e) => this.current.set(parse<ScanDetails>(e)));
    es.addEventListener('progress', (e) => this.mergeSummary(parse<ScanSummary>(e)));
    es.addEventListener('device', (e) => this.addDevice(parse<ScanDeviceResult>(e)));
    es.addEventListener('finished', (e) => {
      this.stopFollowing();
      this.mergeSummary(parse<ScanSummary>(e));
    });
    es.onerror = () => {
      // Stream broke (proxy, network): continue by polling until the scan ends.
      if (this.events === es && this.current()?.status === 'running') this.poll(id);
    };
  }

  private poll(id: string): void {
    this.stopFollowing();
    this.http.get<ScanDetails>(`/api/scans/${id}`).subscribe({
      next: (details) => {
        this.current.set(details);
        if (details.status === 'running') this.pollTimer = setTimeout(() => this.poll(id), POLL_INTERVAL_MS);
      },
      error: (err: unknown) => this.error.set(messageOf(err)),
    });
  }

  private stopFollowing(): void {
    this.events?.close();
    this.events = undefined;
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private mergeSummary(summary: ScanSummary): void {
    this.current.update((c) => (c && c.id === summary.id ? { ...c, ...summary } : c));
  }

  private addDevice(device: ScanDeviceResult): void {
    this.current.update((c) =>
      c && !c.devices.some((d) => d.mac === device.mac && d.ip === device.ip) ? { ...c, devices: [...c.devices, device] } : c,
    );
  }
}

function parse<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

function messageOf(err: unknown): string {
  return toDeviceApiError(err).message;
}
