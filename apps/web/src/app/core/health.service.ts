import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

export type HealthState = 'unknown' | 'ok' | 'down';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);
  readonly state = signal<HealthState>('unknown');

  check(): void {
    this.http.get<{ status: string }>('/api/health').subscribe({
      next: (res) => this.state.set(res.status === 'ok' ? 'ok' : 'down'),
      error: () => this.state.set('down'),
    });
  }
}
