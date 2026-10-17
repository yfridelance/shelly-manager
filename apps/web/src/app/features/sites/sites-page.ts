import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { Site } from '../../core/api.types';
import type { DeviceApiError } from '../../core/devices-api';
import { SiteService, SitesStore } from '../../core/site.service';
import { SitesApi } from '../../core/sites-api';
import { EditableField } from '../../shared/editable-field';

/** Sites (houses, customers): each has its own inventory, templates and log. */
@Component({
  selector: 'app-sites-page',
  imports: [DatePipe, EditableField],
  template: `
    <h1>Standorte</h1>
    <p class="muted intro">
      Jeder Standort (Haus, Kunde, Ferienwohnung …) hat sein eigenes Inventar, eigene Templates und ein eigenes Protokoll.
      Oben rechts wählst du, in welchem Standort du arbeitest. Ein Scan speichert die gefundenen Geräte im gewählten
      Standort; ein Gerät, das schon zu einem anderen Standort gehört, wird nur gemeldet und lässt sich in der Detailansicht
      verschieben.
    </p>

    @if (message(); as m) {
      <p [class]="'message ' + m.kind" role="status">{{ m.text }}</p>
    }

    <table class="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Beschreibung</th>
          <th>Geräte</th>
          <th>Templates</th>
          <th>Angelegt</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        @for (s of sites.list.value(); track s.id) {
          <tr [class.current]="s.id === site.siteId()">
            <td><app-editable-field label="Name" [value]="s.name" (saved)="rename(s, $event, s.description)" /></td>
            <td>
              <app-editable-field label="Beschreibung" [value]="s.description" placeholder="–" (saved)="rename(s, s.name, $event)" />
            </td>
            <td>{{ s.deviceCount }}</td>
            <td>{{ s.templateCount }}</td>
            <td>{{ s.createdAt | date: 'dd.MM.yyyy' }}</td>
            <td class="actions">
              @if (s.id === site.siteId()) {
                <span class="muted">aktuell</span>
              } @else {
                <button type="button" class="link" (click)="site.select(s.id)">Wechseln</button>
              }
              @if (s.deviceCount === 0 && s.templateCount === 0 && sites.list.value().length > 1) {
                @if (confirmDelete() === s.id) {
                  <span>Löschen?</span>
                  <button type="button" class="danger" (click)="remove(s)">Ja</button>
                  <button type="button" class="secondary" (click)="confirmDelete.set(null)">Nein</button>
                } @else {
                  <button type="button" class="link" (click)="confirmDelete.set(s.id)">Löschen</button>
                }
              }
            </td>
          </tr>
        }
      </tbody>
    </table>

    <form class="create" (submit)="create($event)">
      <h2>Neuer Standort</h2>
      <label class="field">
        <span>Name</span>
        <input name="siteName" maxlength="100" [value]="newName()" (input)="newName.set(value($event))" />
      </label>
      <label class="field grow">
        <span>Beschreibung (optional)</span>
        <input name="siteDescription" maxlength="2000" [value]="newDescription()" (input)="newDescription.set(value($event))" />
      </label>
      <button type="submit" [disabled]="!newName().trim()">Anlegen</button>
    </form>
  `,
  styles: `
    .intro { max-width: 52rem; margin-top: 0; }
    tr.current td { background: var(--surface-2); }
    .actions { display: flex; gap: 0.5rem; align-items: center; }
    .create { display: flex; flex-wrap: wrap; align-items: end; gap: 1rem; margin-top: 1.5rem; max-width: 52rem; }
    .create h2 { flex-basis: 100%; font-size: 1.05rem; margin: 0; }
    .grow { flex: 1 1 18rem; }
  `,
})
export class SitesPage {
  private readonly api = inject(SitesApi);
  protected readonly sites = inject(SitesStore);
  protected readonly site = inject(SiteService);
  protected readonly newName = signal('');
  protected readonly newDescription = signal('');
  protected readonly confirmDelete = signal<number | null>(null);
  protected readonly message = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    try {
      const created = await this.api.create({ name: this.newName().trim(), description: this.newDescription().trim() || null });
      this.newName.set('');
      this.newDescription.set('');
      this.sites.list.reload();
      this.message.set({ kind: 'ok', text: `Standort «${created.name}» angelegt.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: (err as DeviceApiError).message });
    }
  }

  protected async rename(s: Site, name: string, description: string | null): Promise<void> {
    if (!name.trim()) return;
    try {
      await this.api.update(s.id, { name: name.trim(), description: description?.trim() || null });
      this.sites.list.reload();
    } catch (err) {
      this.message.set({ kind: 'error', text: (err as DeviceApiError).message });
    }
  }

  protected async remove(s: Site): Promise<void> {
    this.confirmDelete.set(null);
    try {
      await this.api.delete(s.id);
      this.sites.list.reload();
      this.message.set({ kind: 'ok', text: `Standort «${s.name}» gelöscht.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: (err as DeviceApiError).message });
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
