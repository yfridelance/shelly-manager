import { Injectable, signal } from '@angular/core';
import type { DeviceState } from '../../core/api.types';

export type SortKey = 'name' | 'model' | 'gen' | 'ip' | 'mac' | 'firmware' | 'location' | 'state' | 'lastSeen';

/** Filter and sort state, kept across navigation (list -> detail -> back). */
@Injectable({ providedIn: 'root' })
export class InventoryFilters {
  readonly search = signal('');
  readonly gen = signal<number | null>(null);
  /** null: all, '': without location. */
  readonly location = signal<string | null>(null);
  readonly state = signal<DeviceState | null>(null);
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
    this.location.set(null);
    this.state.set(null);
  }
}
