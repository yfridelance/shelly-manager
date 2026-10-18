import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiError, Device, FirmwareChannel, LocalDeviceFields, Snapshot } from './api.types';
import { t } from './i18n/i18n';
import { errorText } from './texts';

export interface Credentials {
  username?: string;
  password: string;
}

/** Error of an API call with the server's code and a translated text for the UI. */
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

export interface FactoryResetResult {
  snapshotId: number | null;
  /** false: the device dropped the connection instead of answering, but was gone afterwards. */
  confirmed: boolean;
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
  factoryReset(mac: string, request: FactoryResetRequest): Promise<FactoryResetResult> {
    return this.call(this.http.post<FactoryResetResult>(`/api/devices/${mac}/factory-reset`, request));
  }

  checkFirmware(mac: string, credentials?: Credentials): Promise<{ stable: string | null; beta: string | null; checkedAt: string }> {
    return this.call(
      this.http.post<{ stable: string | null; beta: string | null; checkedAt: string }>(
        `/api/devices/${mac}/firmware/check`,
        credentials ? { credentials } : {},
      ),
    );
  }

  updateFirmware(mac: string, channel: FirmwareChannel, credentials?: Credentials): Promise<{ version: string }> {
    return this.call(this.http.post<{ version: string }>(`/api/devices/${mac}/firmware/update`, { channel, ...(credentials ? { credentials } : {}) }));
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
    // Fastify's own validation errors carry no code of ours ("Bad Request").
    const code = typeof body?.error === 'string' && /^[a-z_]+$/.test(body.error) ? body.error : err.status === 400 ? 'invalid_input' : null;
    // Always our translated text for the code, never the server's message (German only).
    if (code) return new DeviceApiError(code, errorText(code), body?.cause);
    if (err.status === 0) return new DeviceApiError('offline', errorText('offline'));
    return new DeviceApiError('http_status', t('errors.httpStatus', { status: err.status }));
  }
  return new DeviceApiError('unknown', t('errors.unexpected'));
}
