import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import type { Site } from './api.types';
import { toDeviceApiError } from './devices-api';

@Injectable({ providedIn: 'root' })
export class SitesApi {
  private readonly http = inject(HttpClient);

  create(input: { name: string; description: string | null }): Promise<Site> {
    return this.call(this.http.post<Site>('/api/sites', input));
  }

  update(id: number, input: { name: string; description: string | null }): Promise<Site> {
    return this.call(this.http.put<Site>(`/api/sites/${id}`, input));
  }

  delete(id: number): Promise<unknown> {
    return this.call(this.http.delete(`/api/sites/${id}`));
  }

  /** Moves a device to another site. */
  moveDevice(mac: string, siteId: number): Promise<unknown> {
    return this.call(this.http.patch(`/api/devices/${mac}`, { siteId }));
  }

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (err) {
      throw toDeviceApiError(err);
    }
  }
}
