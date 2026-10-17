import { Injectable, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import type { Site } from './api.types';

const STORAGE_KEY = 'shelly-manager.site';

function readStored(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

/**
 * The site (house, customer) the UI works in. Remembered per browser; lists and actions use it.
 * Holds no data itself, so components and tests do not trigger extra requests.
 */
@Injectable({ providedIn: 'root' })
export class SiteService {
  readonly siteId = signal(readStored());

  select(id: number): void {
    this.siteId.set(id);
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      // private mode / blocked storage: the selection just is not remembered
    }
  }
}

/** List of all sites, shared by the header switcher, the sites page and the device page. */
@Injectable({ providedIn: 'root' })
export class SitesStore {
  readonly list = httpResource<Site[]>(() => '/api/sites', { defaultValue: [] });

  name(id: number): string {
    return this.list.value().find((s) => s.id === id)?.name ?? `Standort ${id}`;
  }
}
