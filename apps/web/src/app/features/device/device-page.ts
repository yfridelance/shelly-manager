import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject, input, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ActionEntry, Device, DeviceDetails, DeviceState, FirmwareChannel, LocalDeviceFields, Snapshot } from '../../core/api.types';
import { actionDetail, actionLabel, actionSummary, unconfirmedResetText } from '../../core/action-text';
import { compareText, t, type TranslationKey } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import { SitesStore } from '../../core/site.service';
import { SitesApi } from '../../core/sites-api';
import { DeviceApiError, DevicesApi, type Credentials, type FactoryResetResult } from '../../core/devices-api';
import { deviceStateText, formatMac, functionsText, shortFirmware } from '../../core/texts';
import { EditableField } from '../../shared/editable-field';
import { kernValue } from '../../core/kern';
import { Feedback } from '../../core/feedback';
import { COMMON_FLOORS, compareFloor } from '../../core/floor';
import { suggestDeviceName } from '../../core/device-name';
import { diffJson, formatDiffValue, type DiffEntry } from '../../shared/json-diff';
import { ResetDialog } from './reset-dialog';

type SnapshotTab = 'config' | 'status' | 'info';

@Component({
  selector: 'app-device-page',
  imports: [DateTimePipe, TranslatePipe, RouterLink, NgTemplateOutlet, EditableField, ResetDialog],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './device-page.html',
  styleUrl: './device-page.scss',
})
export class DevicePage {
  private readonly api = inject(DevicesApi);
  private readonly feedback = inject(Feedback);

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
  // Suggestions for «Stockwerk», «Ort» and «Typ» come from the devices of the same site.
  protected readonly locations = httpResource<Device[]>(
    () => (this.device() ? `/api/devices?site=${this.device()?.siteId}` : undefined),
    { defaultValue: [] },
  );
  protected readonly sites = inject(SitesStore);
  private readonly sitesApi = inject(SitesApi);
  protected readonly locationSuggestions = computed(() =>
    [...new Set(this.locations.value().flatMap((d) => (d.location ? [d.location] : [])))].sort(compareText),
  );
  protected readonly floorSuggestions = computed(() =>
    [...new Set([...COMMON_FLOORS, ...this.locations.value().flatMap((d) => (d.floor ? [d.floor] : []))])].sort((a, b) =>
      compareFloor(a, b, compareText),
    ),
  );
  /** «EG Küche Licht» from floor, location and kind; numbered if the site already has it. */
  protected readonly nameSuggestion = computed(() => {
    const d = this.device();
    return d ? suggestDeviceName(d, this.locations.value()) : null;
  });
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

  protected readonly views = [
    { name: 'config', label: 'device.tab.config' },
    { name: 'status', label: 'device.tab.status' },
    { name: 'info', label: 'device.tab.info' },
  ] as const satisfies readonly { name: SnapshotTab; label: TranslationKey }[];
  protected readonly tab = signal<SnapshotTab>('config');
  protected readonly openDepth = signal(1);
  protected readonly shown = computed(() => {
    const s = this.snapshot();
    return s ? s[this.tab()] : null;
  });

  protected readonly saving = signal(false);
  /** Errors and warnings stay on the page; successes are toasts. */
  protected readonly message = signal<{ kind: 'warn' | 'error'; text: string } | null>(null);

  // Device actions. The password lives only until the next request is sent.
  protected readonly running = signal<'snapshot' | 'reboot' | 'firmware' | 'name' | null>(null);
  protected readonly username = signal('admin');
  protected readonly password = signal('');
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
      if (field !== 'notes') this.locations.reload();
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.saveFailed', { error: (err as DeviceApiError).message }) });
    } finally {
      this.saving.set(false);
    }
  }

  /** Writes the local name to the device after a confirmation. */
  protected async writeName(): Promise<void> {
    const device = this.device();
    if (!device?.name) return;
    const ok = await this.feedback.confirm({
      heading: t('device.writeNameQuestion', { name: device.name }),
      confirmLabel: t('device.writeNameConfirm'),
    });
    if (!ok) return;
    const credentials = this.takeCredentials(device);
    this.running.set('name');
    this.message.set(null);
    try {
      const { name } = await this.api.writeName(device.mac, device.name, credentials);
      this.details.reload();
      this.feedback.success(t('device.writeNameDone', { name }));
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.writeNameFailed', { error: (err as DeviceApiError).message }) });
    } finally {
      this.running.set(null);
      this.recentActions.reload();
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

  /** Moves the device to another site after a confirmation; on cancel the select shows the current site again. */
  protected async onSiteChange(event: Event, current: number): Promise<void> {
    const device = this.device();
    const target = Number(kernValue(event));
    if (!device || !target || target === current) return;
    const ok = await this.feedback.confirm({
      heading: t('device.moveQuestion', { site: this.sites.name(target) }),
      confirmLabel: t('device.moveConfirm'),
    });
    if (!ok) {
      const select = event.target as { value?: string } | null;
      if (select) select.value = String(current);
      return;
    }
    try {
      await this.sitesApi.moveDevice(device.mac, target);
      this.details.reload();
      this.sites.list.reload();
      this.feedback.success(t('device.moved', { site: this.sites.name(target) }));
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
      this.feedback.success(t('device.snapshotDone'));
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
    const ok = await this.feedback.confirm({ heading: t('device.rebootQuestion'), confirmLabel: t('device.rebootConfirm'), danger: true });
    if (!ok) return;
    const credentials = this.takeCredentials(device);
    this.running.set('reboot');
    this.message.set(null);
    try {
      await this.api.reboot(device.mac, credentials);
      this.feedback.success(t('device.rebootDone'));
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
      this.feedback.success(
        result.stable
          ? t('device.firmware.available', { version: shortFirmware(result.stable) })
          : result.beta
            ? t('device.firmware.currentWithBeta', { version: shortFirmware(result.beta) })
            : t('device.firmware.isCurrent'),
      );
    } catch (err) {
      this.message.set({ kind: 'error', text: t('device.firmware.checkFailed', { error: (err as DeviceApiError).message }) });
    } finally {
      this.running.set(null);
    }
  }

  protected async installUpdate(channel: FirmwareChannel): Promise<void> {
    const device = this.device();
    if (!device) return;
    const offered = shortFirmware(channel === 'beta' ? device.updateBeta : device.updateStable);
    const ok = await this.feedback.confirm({
      heading: t(channel === 'beta' ? 'device.firmware.installBetaQuestion' : 'device.firmware.installQuestion', { version: offered }),
      confirmLabel: t('device.firmware.installConfirm'),
      danger: true,
    });
    if (!ok) return;
    const credentials = this.takeCredentials(device);
    this.running.set('firmware');
    this.message.set(null);
    try {
      const { version } = await this.api.updateFirmware(device.mac, channel, credentials);
      this.feedback.success(t('device.firmware.started', { version: shortFirmware(version) }));
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
    const text = [
      result.confirmed === false ? t('device.reset.unconfirmed', { text: unconfirmedResetText() }) : t('device.reset.done'),
      result.snapshotId !== null ? t('device.reset.snapshotSaved') : t('device.reset.noSnapshot'),
    ].join(' ');
    // An unconfirmed reset stays on the page: the user has to check the device.
    if (result.confirmed === false) this.message.set({ kind: 'warn', text });
    else this.feedback.success(text);
  }

  protected onResetClosed(): void {
    this.resetOpen.set(false);
    this.recentActions.reload();
  }

  protected async copyShown(): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(this.shown(), null, 2));
    this.feedback.success(t('device.copied'));
  }

  protected onTab(event: Event): void {
    const name = kernValue(event) as SnapshotTab;
    if (this.views.some((v) => v.name === name)) this.tab.set(name);
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

  protected stateTone(state: DeviceState): 'ok' | 'warn' | 'neutral' {
    return state === 'active' ? 'ok' : state === 'missing' ? 'warn' : 'neutral';
  }
}
