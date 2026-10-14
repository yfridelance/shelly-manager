import { Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { Device, DeviceDetails, LocalDeviceFields, Snapshot } from '../../core/api.types';
import { DeviceApiError, DevicesApi } from '../../core/devices-api';
import { DEVICE_STATE_TEXT, formatMac, shortFirmware } from '../../core/texts';
import { EditableField } from '../../shared/editable-field';
import { JsonTree } from '../../shared/json-tree';

type SnapshotTab = 'config' | 'status' | 'info';

@Component({
  selector: 'app-device-page',
  imports: [DatePipe, RouterLink, EditableField, JsonTree],
  templateUrl: './device-page.html',
  styleUrl: './device-page.scss',
})
export class DevicePage {
  private readonly api = inject(DevicesApi);

  /** Route parameter (component input binding). */
  readonly mac = input.required<string>();

  protected readonly stateText = DEVICE_STATE_TEXT;
  protected readonly formatMac = formatMac;
  protected readonly shortFirmware = shortFirmware;

  protected readonly details = httpResource<DeviceDetails>(() => `/api/devices/${encodeURIComponent(this.mac())}`);
  protected readonly device = computed(() => this.details.hasValue() ? this.details.value().device : null);
  protected readonly locations = httpResource<Device[]>(() => '/api/devices', { defaultValue: [] });
  protected readonly locationSuggestions = computed(() =>
    [...new Set(this.locations.value().flatMap((d) => (d.location ? [d.location] : [])))].sort(),
  );

  // Snapshot history: null = latest.
  protected readonly selectedId = signal<number | null>(null);
  private readonly selected = httpResource<Snapshot>(() => {
    const id = this.selectedId();
    const latest = this.details.hasValue() ? this.details.value().latestSnapshot : null;
    return id === null || id === latest?.id ? undefined : `/api/devices/${encodeURIComponent(this.mac())}/snapshots/${id}`;
  });
  protected readonly snapshot = computed<Snapshot | null>(() => {
    const latest = this.details.hasValue() ? this.details.value().latestSnapshot : null;
    const id = this.selectedId();
    if (id === null || id === latest?.id) return latest;
    return this.selected.hasValue() ? this.selected.value() : null;
  });
  protected readonly tab = signal<SnapshotTab>('config');
  protected readonly openDepth = signal(1);
  protected readonly shown = computed(() => {
    const s = this.snapshot();
    return s ? s[this.tab()] : null;
  });

  protected readonly saving = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Manual snapshot; the password lives only until the request is sent.
  protected readonly snapshotting = signal(false);
  protected readonly username = signal('admin');
  protected readonly password = signal('');

  protected async saveField(field: keyof LocalDeviceFields, value: string): Promise<void> {
    const device = this.device();
    if (!device) return;
    this.saving.set(true);
    this.message.set(null);
    try {
      const updated = await this.api.update(device.mac, { [field]: value });
      this.details.update((d) => (d ? { ...d, device: updated } : d));
      if (field === 'location') this.locations.reload();
    } catch (err) {
      this.message.set({ kind: 'error', text: `Speichern fehlgeschlagen: ${(err as DeviceApiError).message}` });
    } finally {
      this.saving.set(false);
    }
  }

  protected async takeSnapshot(): Promise<void> {
    const device = this.device();
    if (!device) return;
    const password = this.password();
    this.password.set('');
    const username = this.username().trim();
    this.snapshotting.set(true);
    this.message.set(null);
    try {
      await this.api.snapshot(
        device.mac,
        device.authRequired && password ? { password, ...(device.gen === 1 && username ? { username } : {}) } : undefined,
      );
      this.selectedId.set(null);
      this.details.reload();
      this.message.set({ kind: 'ok', text: 'Config wurde neu eingelesen.' });
    } catch (err) {
      this.message.set({ kind: 'error', text: `Snapshot fehlgeschlagen: ${(err as DeviceApiError).message}` });
    } finally {
      this.snapshotting.set(false);
    }
  }

  protected async copyShown(): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(this.shown(), null, 2));
    this.message.set({ kind: 'ok', text: 'JSON in die Zwischenablage kopiert.' });
  }

  protected selectSnapshot(value: string): void {
    this.selectedId.set(value ? Number(value) : null);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
