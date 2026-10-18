import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import type { Device, DeviceState } from '../../core/api.types';
import { compareText, currentLanguage, type TranslationKey } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import {
  DEVICE_STATES,
  FUNCTION_FILTERS,
  deviceStateText,
  formatMac,
  functionFilterText,
  functionsText,
  ipSortKey,
  matchesFunction,
  shortFirmware,
  type FunctionFilter,
} from '../../core/texts';
import { FirmwareCheckPanel, type FirmwareCheckResult } from './firmware-check-panel';
import { InventoryFilters, type SortKey } from './inventory-filters';
import { SiteService } from '../../core/site.service';
import { compareFloor } from '../../core/floor';

import { kernChecked, kernValue } from '../../core/kern';
@Component({
  selector: 'app-inventory-page',
  imports: [DateTimePipe, TranslatePipe, RouterLink, FirmwareCheckPanel],
  templateUrl: './inventory-page.html',
  styleUrl: './inventory-page.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class InventoryPage {
  private readonly router = inject(Router);
  protected readonly f = inject(InventoryFilters);
  protected readonly stateText = deviceStateText;
  protected readonly states = DEVICE_STATES;
  protected readonly formatMac = formatMac;
  protected readonly shortFirmware = shortFirmware;
  protected readonly functionsText = functionsText;
  protected readonly functionFilterText = functionFilterText;
  protected readonly functionFilters = FUNCTION_FILTERS;
  protected readonly placeText = placeText;

  protected readonly columns: { key: SortKey; label: TranslationKey }[] = [
    { key: 'name', label: 'columns.name' },
    { key: 'deviceId', label: 'columns.deviceId' },
    { key: 'model', label: 'columns.model' },
    { key: 'gen', label: 'columns.gen' },
    { key: 'ip', label: 'columns.ip' },
    { key: 'mac', label: 'columns.mac' },
    { key: 'firmware', label: 'columns.firmware' },
    { key: 'kind', label: 'columns.kind' },
    { key: 'location', label: 'columns.location' },
    { key: 'state', label: 'columns.state' },
    { key: 'lastSeen', label: 'columns.lastSeen' },
  ];

  protected readonly site = inject(SiteService);
  /** CSV headers and labels follow the UI language. */
  protected readonly language = currentLanguage;
  protected readonly devices = httpResource<Device[]>(() => `/api/devices?site=${this.site.siteId()}`, { defaultValue: [] });

  protected readonly locations = computed(() =>
    [...new Set(this.devices.value().flatMap((d) => (d.location ? [d.location] : [])))].sort(compareText),
  );
  protected readonly floors = computed(() =>
    [...new Set(this.devices.value().flatMap((d) => (d.floor ? [d.floor] : [])))].sort((a, b) => compareFloor(a, b, compareText)),
  );
  protected readonly updateCount = computed(() => this.devices.value().filter((d) => d.updateStable !== null).length);
  protected readonly gens = computed(() => [...new Set(this.devices.value().map((d) => d.gen))].sort());

  protected readonly filtered = computed(() => {
    const search = this.f.search().trim().toLowerCase();
    const gen = this.f.gen();
    const floor = this.f.floor();
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
        (floor === null || (d.floor ?? '') === floor) &&
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
      this.f.floor() !== null ||
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

  protected readonly value = kernValue;
  protected readonly checked = kernChecked;

  protected stateTone(state: Device['state']): 'ok' | 'warn' | 'neutral' {
    return state === 'active' ? 'ok' : state === 'missing' ? 'warn' : 'neutral';
  }

  protected setGen(value: string): void {
    this.f.gen.set(value ? Number(value) : null);
  }

  protected setFloor(value: string): void {
    this.f.floor.set(value === '*' ? null : value);
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
  return [d.name, d.deviceName, d.deviceId, d.mac, formatMac(d.mac), d.ip, d.model, d.app, d.floor, d.location, d.kind, functionsText(d.functions), d.notes, d.firmware]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** «EG · Küche» */
export function placeText(d: Pick<Device, 'floor' | 'location'>): string {
  return [d.floor, d.location].filter(Boolean).join(' · ');
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
      return compareText(a.name ?? `￿${a.mac}`, b.name ?? `￿${b.mac}`);
    case 'firmware':
      return compareText(shortFirmware(a.firmware), shortFirmware(b.firmware));
    case 'state':
      return compareText(deviceStateText(a.state), deviceStateText(b.state));
    case 'location':
      // Building order: floor first (UG, EG, 1. OG … DG), then the location; empty values last.
      return compareFloor(a.floor, b.floor, compareText) || compareText(a.location ?? '￿', b.location ?? '￿');
    case 'kind':
      // Type first, then the derived function; devices with neither last.
      return compareText(kindSortKey(a), kindSortKey(b));
    default:
      // Empty values last.
      return compareText(a[key] ?? '￿', b[key] ?? '￿');
  }
}
