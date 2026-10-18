import { Injectable, signal } from '@angular/core';
import type { DeviceState } from '../../core/api.types';
import type { FunctionFilter } from '../../core/texts';

export type SortKey = 'name' | 'deviceId' | 'model' | 'gen' | 'ip' | 'mac' | 'firmware' | 'kind' | 'location' | 'state' | 'lastSeen';

/** Filter and sort state, kept across navigation (list -> detail -> back). */
@Injectable({ providedIn: 'root' })
export class InventoryFilters {
  readonly search = signal('');
  readonly gen = signal<number | null>(null);
  /** null: all, '': without floor. */
  readonly floor = signal<string | null>(null);
  /** null: all, '': without location. */
  readonly location = signal<string | null>(null);
  readonly state = signal<DeviceState | null>(null);
  readonly function = signal<FunctionFilter | null>(null);
  readonly onlyUpdates = signal(false);
  readonly sortKey = signal<SortKey>('name');
  readonly sortAsc = signal(true);

  sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortAsc.update((a) => !a);
    else {
      this.sortKey.set(key);
      this.sortAsc.set(true);
    }
  }

  reset(): void {
    this.search.set('');
    this.gen.set(null);
    this.floor.set(null);
    this.location.set(null);
    this.state.set(null);
    this.function.set(null);
    this.onlyUpdates.set(false);
  }
}
