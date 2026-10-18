import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject, input, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { ActionEntry, Device, DeviceDetails, DeviceState, FirmwareChannel, LocalDeviceFields, Snapshot } from '../../core/api.types';
import { actionDetail, actionLabel, actionSummary, unconfirmedResetText } from '../../core/action-text';
import { compareText, t } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import { SitesStore } from '../../core/site.service';
import { SitesApi } from '../../core/sites-api';
import { DeviceApiError, DevicesApi, type Credentials, type FactoryResetResult } from '../../core/devices-api';
import { deviceStateText, formatMac, functionsText, shortFirmware } from '../../core/texts';
import { EditableField } from '../../shared/editable-field';
import { kernValue } from '../../core/kern';
import { diffJson, formatDiffValue, type DiffEntry } from '../../shared/json-diff';
import { ResetDialog } from './reset-dialog';

type SnapshotTab = 'config' | 'status' | 'info';

@Component({
  selector: 'app-device-page',
  imports: [DateTimePipe, TranslatePipe, RouterLink, EditableField, ResetDialog],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './device-page.html',
  styleUrl: './device-page.scss',
})
export class DevicePage {
  private readonly api = inject(DevicesApi);

  /** Route parameter (component input binding). */
  readonly mac = input.required<string>();

  protected readonly stateText = deviceStateText;
  protected readonly actionLabel = actionLabel;
  protected readonly actionSummary = actionSummary;
  protected readonly actionDetail = actionDetail;
  protected readonly formatMac = formatMac;
  protected readonly shortFirmware = shortFirmware;
  protected readonly functionsText = functionsText;

  protected readonly details = httpResource<DeviceDetails>(() => `/api/devices/${encodeURIComponent(this.mac())}`);
  protected readonly device = computed(() => this.details.hasValue() ? this.details.value().device : null);
  // Suggestions for «Ort» and «Typ» come from the devices of the same site.
  protected readonly locations = httpResource<Device[]>(
    () => (this.device() ? `/api/devices?site=${this.device()?.siteId}` : undefined),
    { defaultValue: [] },
  );
  protected readonly sites = inject(SitesStore);
  private readonly sitesApi = inject(SitesApi);
  protected readonly moveTo = signal<number | null>(null);
  protected readonly locationSuggestions = computed(() =>
    [...new Set(this.locations.value().flatMap((d) => (d.location ? [d.location] : [])))].sort(compareText),
  );
  protected readonly kindSuggestions = computed(() =>
    [
      ...new Set([
        ...t('device.kindSuggestions').split(',').map((k) => k.trim()).filter(Boolean),
        ...this.locations.value().flatMap((d) => (d.kind ? [d.kind] : [])),
      ]),
    ].sort(compareText),
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

  // Comparison with a second snapshot: null = no comparison.
  protected readonly compareId = signal<number | null>(null);
  private readonly compared = httpResource<Snapshot>(() => {
    const id = this.compareId();
    const latest = this.details.hasValue() ? this.details.value().latestSnapshot : null;
    return id === null || id === latest?.id ? undefined : `/api/devices/${encodeURIComponent(this.mac())}/snapshots/${id}`;
  });
  protected readonly compareSnapshot = computed<Snapshot | null>(() => {
    const latest = this.details.hasValue() ? this.details.value().latestSnapshot : null;
    const id = this.compareId();
    if (id === null) return null;
    if (id === latest?.id) return latest;
    return this.compared.hasValue() ? this.compared.value() : null;
  });
  /** Older snapshot as "before", newer as "after", regardless of which one was picked first. */
  protected readonly comparison = computed<{ before: Snapshot; after: Snapshot; entries: DiffEntry[] } | null>(() => {
    const a = this.snapshot();
    const b = this.compareSnapshot();
    if (!a || !b) return null;
    const [before, after] = a.takenAt <= b.takenAt ? [a, b] : [b, a];
    return { before, after, entries: diffJson(before[this.tab()], after[this.tab()]) };
  });
  protected readonly formatDiffValue = formatDiffValue;
  protected readonly diffKindText = (kind: DiffEntry['kind']): string => t(`device.diff.${kind}`);

  protected readonly tab = signal<SnapshotTab>('config');
  protected readonly openDepth = signal(1);
  protected readonly shown = computed(() => {
    const s = this.snapshot();
    return s ? s[this.tab()] : null;
  });

  protected readonly saving = signal(false);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Device actions. The password lives only until the next request is sent.
  protected readonly running = signal<'snapshot' | 'reboot' | 'firmware' | null>(null);
  /** Channel waiting for the user's confirmation before the update starts. */
  protected readonly confirmUpdate = signal<FirmwareChannel | null>(null);
  protected readonly username = signal('admin');
  protected readonly password = signal('');
  protected readonly confirmReboot = signal(false);
  protected readonly resetOpen = signal(false);
  protected readonly recentActions = httpResource<ActionEntry[]>(
    () => `/api/actions?mac=${encodeURIComponent(this.mac())}&limit=10`,
    { defaultValue: [] },
  );

  protected async saveField(field: keyof LocalDeviceFields, value: string): Promise<void> {
    const device = this.device();
    if (!device) return;
    this.saving.set(true);
    this.message.set(null);
    try {
      const updated = await this.api.update(device.mac, { [field]: value });
      this.details.update((d) => (d ? { ...d, device: updated } : d));
      if (field === 'location' || field === 'kind') this.locations.reload();
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.saveFailed', { error: (err as DeviceApiError).message }) });
    } finally {
      this.saving.set(false);
    }
  }

  /** Credentials for a protected device, taken from the form and cleared right away. */
  private takeCredentials(device: Device): Credentials | undefined {
    const password = this.password();
    this.password.set('');
    if (!device.authRequired || !password) return undefined;
    const username = this.username().trim();
    return { password, ...(device.gen === 1 && username ? { username } : {}) };
  }

  /** Moves the device to another site (after a confirmation in the UI). */
  protected async moveDevice(): Promise<void> {
    const device = this.device();
    const target = this.moveTo();
    if (!device || target === null) return;
    this.moveTo.set(null);
    try {
      await this.sitesApi.moveDevice(device.mac, target);
      this.details.reload();
      this.sites.list.reload();
      this.message.set({ kind: 'ok', text: t('device.moved', { site: this.sites.name(target) }) });
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.moveFailed', { error: (err as DeviceApiError).message }) });
    }
  }

  protected async takeSnapshot(): Promise<void> {
    const device = this.device();
    if (!device) return;
    const credentials = this.takeCredentials(device);
    this.running.set('snapshot');
    this.message.set(null);
    try {
      await this.api.snapshot(device.mac, credentials);
      this.selectedId.set(null);
      this.compareId.set(null);
      this.details.reload();
      this.message.set({ kind: 'ok', text: t('device.snapshotDone') });
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.snapshotFailed', { error: (err as DeviceApiError).message }) });
    } finally {
      this.running.set(null);
      this.recentActions.reload();
    }
  }

  protected async reboot(): Promise<void> {
    const device = this.device();
    if (!device) return;
    this.confirmReboot.set(false);
    const credentials = this.takeCredentials(device);
    this.running.set('reboot');
    this.message.set(null);
    try {
      await this.api.reboot(device.mac, credentials);
      this.message.set({ kind: 'ok', text: t('device.rebootDone') });
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.rebootFailed', { error: (err as DeviceApiError).message }) });
    } finally {
      this.running.set(null);
      this.recentActions.reload();
    }
  }

  protected async checkFirmware(): Promise<void> {
    const device = this.device();
    if (!device) return;
    const credentials = this.takeCredentials(device);
    this.running.set('firmware');
    this.message.set(null);
    try {
      const result = await this.api.checkFirmware(device.mac, credentials);
      this.details.update((d) =>
        d ? { ...d, device: { ...d.device, updateStable: result.stable, updateBeta: result.beta, updateCheckedAt: result.checkedAt } } : d,
      );
      this.message.set({
        kind: 'ok',
        text: result.stable
          ? t('device.firmware.available', { version: shortFirmware(result.stable) })
          : result.beta
            ? t('device.firmware.currentWithBeta', { version: shortFirmware(result.beta) })
            : t('device.firmware.isCurrent'),
      });
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.firmware.checkFailed', { error: (err as DeviceApiError).message }) });
    } finally {
      this.running.set(null);
    }
  }

  protected async installUpdate(channel: FirmwareChannel): Promise<void> {
    const device = this.device();
    if (!device) return;
    this.confirmUpdate.set(null);
    const credentials = this.takeCredentials(device);
    this.running.set('firmware');
    this.message.set(null);
    try {
      const { version } = await this.api.updateFirmware(device.mac, channel, credentials);
      this.message.set({
        kind: 'ok',
        text: t('device.firmware.started', { version: shortFirmware(version) }),
      });
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.firmware.updateFailed', { error: (err as DeviceApiError).message }) });
    } finally {
      this.running.set(null);
      this.recentActions.reload();
    }
  }

  protected onResetDone(result: FactoryResetResult): void {
    this.resetOpen.set(false);
    this.selectedId.set(null);
    this.details.reload();
    this.recentActions.reload();
    this.message.set({
      kind: 'ok',
      text: [
        result.confirmed === false ? t('device.reset.unconfirmed', { text: unconfirmedResetText() }) : t('device.reset.done'),
        result.snapshotId !== null ? t('device.reset.snapshotSaved') : t('device.reset.noSnapshot'),
      ].join(' '),
    });
  }

  protected onResetClosed(): void {
    this.resetOpen.set(false);
    this.recentActions.reload();
  }

  protected async copyShown(): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(this.shown(), null, 2));
    this.message.set({ kind: 'ok', text: t('device.copied') });
  }

  protected selectSnapshot(value: string): void {
    this.selectedId.set(value ? Number(value) : null);
    // Comparing a snapshot with itself makes no sense.
    if (this.compareId() !== null && this.compareId() === this.shownId()) this.compareId.set(null);
  }

  protected selectCompare(value: string): void {
    this.compareId.set(value ? Number(value) : null);
  }

  /** Id of the snapshot currently shown (the latest when none is selected). */
  protected shownId(): number | null {
    return this.selectedId() ?? (this.details.hasValue() ? (this.details.value().latestSnapshot?.id ?? null) : null);
  }

  protected countKind(entries: DiffEntry[], kind: DiffEntry['kind']): number {
    return entries.filter((e) => e.kind === kind).length;
  }

  protected readonly value = kernValue;

  protected onSiteChange(value: string, current: number): void {
    const id = Number(value);
    if (id && id !== current) this.moveTo.set(id);
  }

  protected stateTone(state: DeviceState): 'ok' | 'warn' | 'neutral' {
    return state === 'active' ? 'ok' : state === 'missing' ? 'warn' : 'neutral';
  }
}
