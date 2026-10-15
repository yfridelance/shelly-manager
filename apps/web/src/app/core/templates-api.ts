import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import type { ApplyTemplateResult, Template, TemplatePreview, TemplateSettings } from './api.types';
import { toDeviceApiError, type Credentials } from './devices-api';

export interface TemplateInput {
  name: string;
  description: string | null;
  settings: TemplateSettings;
}

export interface ApplyRequest {
  templateId: number;
  credentials?: Credentials;
  secrets?: { mqttPassword?: string; apPassword?: string };
  rebootIfRequired?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TemplatesApi {
  private readonly http = inject(HttpClient);

  create(input: TemplateInput): Promise<Template> {
    return this.call(this.http.post<Template>('/api/templates', input));
  }

  update(id: number, input: TemplateInput): Promise<Template> {
    return this.call(this.http.put<Template>(`/api/templates/${id}`, input));
  }

  delete(id: number): Promise<unknown> {
    return this.call(this.http.delete(`/api/templates/${id}`));
  }

  preview(id: number, macs?: string[]): Promise<TemplatePreview[]> {
    return this.call(this.http.post<TemplatePreview[]>(`/api/templates/${id}/preview`, macs ? { macs } : {}));
  }

  apply(mac: string, request: ApplyRequest): Promise<ApplyTemplateResult> {
    return this.call(this.http.post<ApplyTemplateResult>(`/api/devices/${mac}/apply-template`, request));
  }

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (err) {
      throw toDeviceApiError(err);
    }
  }
}
