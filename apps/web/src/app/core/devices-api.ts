import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiError, Device, LocalDeviceFields, Snapshot } from './api.types';
import { errorText } from './texts';

export interface Credentials {
  username?: string;
  password: string;
}

/** Error of a device call with the server's code and a German text for the UI. */
export class DeviceApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** For snapshot_failed: why the snapshot failed. */
    readonly causeCode?: string,
  ) {
    super(message);
  }
}

export interface FactoryResetRequest {
  confirmMac: string;
  credentials?: Credentials;
  allowWithoutSnapshot?: boolean;
}

@Injectable({ providedIn: 'root' })
export class DevicesApi {
  private readonly http = inject(HttpClient);

  update(mac: string, fields: LocalDeviceFields): Promise<Device> {
    return this.call(this.http.patch<Device>(`/api/devices/${mac}`, fields));
  }

  snapshot(mac: string, credentials?: Credentials): Promise<Snapshot> {
    return this.call(this.http.post<Snapshot>(`/api/devices/${mac}/snapshot`, credentials ? { credentials } : {}));
  }

  reboot(mac: string, credentials?: Credentials): Promise<{ ok: true }> {
    return this.call(this.http.post<{ ok: true }>(`/api/devices/${mac}/reboot`, credentials ? { credentials } : {}));
  }

  /** Exactly one device. The server checks confirmMac again. */
  factoryReset(mac: string, request: FactoryResetRequest): Promise<{ snapshotId: number | null }> {
    return this.call(this.http.post<{ snapshotId: number | null }>(`/api/devices/${mac}/factory-reset`, request));
  }

  private async call<T>(request: import('rxjs').Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (err) {
      throw toDeviceApiError(err);
    }
  }
}

export function toDeviceApiError(err: unknown): DeviceApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as (Partial<ApiError> & { cause?: string }) | null;
    if (body?.error) return new DeviceApiError(body.error, errorText(body.error), body.cause);
    if (err.status === 0) return new DeviceApiError('offline', 'Server nicht erreichbar.');
    return new DeviceApiError('http', `Anfrage fehlgeschlagen (HTTP ${err.status}).`);
  }
  return new DeviceApiError('unknown', 'Unbekannter Fehler.');
}
