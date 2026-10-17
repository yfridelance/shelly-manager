import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import type { Device, DeviceState } from '../../core/api.types';
import {
  DEVICE_STATE_TEXT,
  FUNCTION_FILTER_TEXT,
  formatMac,
  functionsText,
  ipSortKey,
  matchesFunction,
  shortFirmware,
  type FunctionFilter,
} from '../../core/texts';
import { FirmwareCheckPanel, type FirmwareCheckResult } from './firmware-check-panel';
import { InventoryFilters, type SortKey } from './inventory-filters';
import { SiteService } from '../../core/site.service';

const collator = new Intl.Collator('de-CH', { numeric: true, sensitivity: 'base' });

@Component({
  selector: 'app-inventory-page',
  imports: [DatePipe, RouterLink, FirmwareCheckPanel],
  templateUrl: './inventory-page.html',
  styleUrl: './inventory-page.scss',
})
export class InventoryPage {
  private readonly router = inject(Router);
  protected readonly f = inject(InventoryFilters);
  protected readonly stateText = DEVICE_STATE_TEXT;
  protected readonly states = Object.keys(DEVICE_STATE_TEXT) as DeviceState[];
  protected readonly formatMac = formatMac;
  protected readonly shortFirmware = shortFirmware;
  protected readonly functionsText = functionsText;
  protected readonly functionFilterText = FUNCTION_FILTER_TEXT;
  protected readonly functionFilters = Object.keys(FUNCTION_FILTER_TEXT) as FunctionFilter[];

  protected readonly columns: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'deviceId', label: 'Geräte-ID' },
    { key: 'model', label: 'Modell' },
    { key: 'gen', label: 'Gen' },
    { key: 'ip', label: 'IP' },
    { key: 'mac', label: 'MAC' },
    { key: 'firmware', label: 'Firmware' },
    { key: 'kind', label: 'Typ / Funktion' },
    { key: 'location', label: 'Ort' },
    { key: 'state', label: 'Status' },
    { key: 'lastSeen', label: 'Zuletzt gesehen' },
  ];

  protected readonly site = inject(SiteService);
  protected readonly devices = httpResource<Device[]>(() => `/api/devices?site=${this.site.siteId()}`, { defaultValue: [] });

  protected readonly locations = computed(() =>
    [...new Set(this.devices.value().flatMap((d) => (d.location ? [d.location] : [])))].sort(collator.compare),
  );
  protected readonly updateCount = computed(() => this.devices.value().filter((d) => d.updateStable !== null).length);
  protected readonly gens = computed(() => [...new Set(this.devices.value().map((d) => d.gen))].sort());

  protected readonly filtered = computed(() => {
    const search = this.f.search().trim().toLowerCase();
    const gen = this.f.gen();
    const location = this.f.location();
    const state = this.f.state();
    const fn = this.f.function();
    const onlyUpdates = this.f.onlyUpdates();
    const rows = this.devices.value().filter(
      (d) =>
        (!onlyUpdates || d.updateStable !== null) &&
        (gen === null || d.gen === gen) &&
        (state === null || d.state === state) &&
        (fn === null || matchesFunction(d.functions, fn)) &&
        (location === null || (d.location ?? '') === location) &&
        (!search || haystack(d).includes(search)),
    );
    const key = this.f.sortKey();
    const dir = this.f.sortAsc() ? 1 : -1;
    return rows.sort((a, b) => dir * compare(a, b, key));
  });

  protected readonly hasFilter = computed(
    () =>
      !!this.f.search() ||
      this.f.gen() !== null ||
      this.f.location() !== null ||
      this.f.state() !== null ||
      this.f.function() !== null ||
      this.f.onlyUpdates(),
  );

  /** Live update of one row after its firmware check. */
  protected applyCheck(result: FirmwareCheckResult): void {
    if (result.checkedAt === null) return;
    this.devices.update((list) =>
      list.map((d) =>
        d.mac === result.mac ? { ...d, updateStable: result.stable, updateBeta: result.beta, updateCheckedAt: result.checkedAt } : d,
      ),
    );
  }

  protected showOnlyUpdates(): void {
    this.f.reset();
    this.f.onlyUpdates.set(true);
  }

  protected open(device: Device): void {
    void this.router.navigate(['/inventar', device.mac]);
  }

  protected ariaSort(key: SortKey): 'ascending' | 'descending' | null {
    return this.f.sortKey() === key ? (this.f.sortAsc() ? 'ascending' : 'descending') : null;
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setGen(value: string): void {
    this.f.gen.set(value ? Number(value) : null);
  }

  protected setLocation(value: string): void {
    this.f.location.set(value === '*' ? null : value);
  }

  protected setFunction(value: string): void {
    this.f.function.set((value || null) as FunctionFilter | null);
  }

  protected setState(value: string): void {
    this.f.state.set((value || null) as DeviceState | null);
  }
}

function haystack(d: Device): string {
  return [d.name, d.deviceName, d.deviceId, d.mac, formatMac(d.mac), d.ip, d.model, d.app, d.location, d.kind, functionsText(d.functions), d.notes, d.firmware]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function kindSortKey(d: Device): string {
  return `${d.kind ?? '￿'}|${functionsText(d.functions) || '￿'}`;
}

function compare(a: Device, b: Device, key: SortKey): number {
  switch (key) {
    case 'gen':
      return a.gen - b.gen;
    case 'ip':
      return ipSortKey(a.ip) - ipSortKey(b.ip);
    case 'lastSeen':
      return a.lastSeen.localeCompare(b.lastSeen);
    case 'name':
      // Unnamed devices last, ordered by MAC.
      return collator.compare(a.name ?? `￿${a.mac}`, b.name ?? `￿${b.mac}`);
    case 'firmware':
      return collator.compare(shortFirmware(a.firmware), shortFirmware(b.firmware));
    case 'state':
      return collator.compare(DEVICE_STATE_TEXT[a.state], DEVICE_STATE_TEXT[b.state]);
    case 'kind':
      // Type first, then the derived function; devices with neither last.
      return collator.compare(kindSortKey(a), kindSortKey(b));
    default:
      // Empty values last.
      return collator.compare(a[key] ?? '￿', b[key] ?? '￿');
  }
}
