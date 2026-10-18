import { Component, inject, signal } from '@angular/core';
import type { Site } from '../../core/api.types';
import { t } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import type { DeviceApiError } from '../../core/devices-api';
import { SiteService, SitesStore } from '../../core/site.service';
import { SitesApi } from '../../core/sites-api';
import { EditableField } from '../../shared/editable-field';

/** Sites (houses, customers): each has its own inventory, templates and log. */
@Component({
  selector: 'app-sites-page',
  imports: [DateTimePipe, TranslatePipe, EditableField],
  template: `
    <h1>{{ 'nav.sites' | t }}</h1>
    <p class="muted intro">{{ 'sites.intro' | t }}</p>

    @if (message(); as m) {
      <p [class]="'message ' + m.kind" role="status">{{ m.text }}</p>
    }

    <table class="data-table">
      <thead>
        <tr>
          <th>{{ 'common.name' | t }}</th>
          <th>{{ 'common.description' | t }}</th>
          <th>{{ 'sites.devices' | t }}</th>
          <th>{{ 'nav.templates' | t }}</th>
          <th>{{ 'sites.created' | t }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        @for (s of sites.list.value(); track s.id) {
          <tr [class.current]="s.id === site.siteId()">
            <td><app-editable-field [label]="'common.name' | t" [value]="s.name" (saved)="rename(s, $event, s.description)" /></td>
            <td>
              <app-editable-field [label]="'common.description' | t" [value]="s.description" placeholder="–" (saved)="rename(s, s.name, $event)" />
            </td>
            <td>{{ s.deviceCount }}</td>
            <td>{{ s.templateCount }}</td>
            <td>{{ s.createdAt | dateTime: 'date' }}</td>
            <td class="actions">
              @if (s.id === site.siteId()) {
                <span class="muted">{{ 'sites.current' | t }}</span>
              } @else {
                <button type="button" class="link" (click)="site.select(s.id)">{{ 'sites.switch' | t }}</button>
              }
              @if (s.deviceCount === 0 && s.templateCount === 0 && sites.list.value().length > 1) {
                @if (confirmDelete() === s.id) {
                  <span>{{ 'common.deleteQuestion' | t }}</span>
                  <button type="button" class="danger" (click)="remove(s)">{{ 'common.yes' | t }}</button>
                  <button type="button" class="secondary" (click)="confirmDelete.set(null)">{{ 'common.no' | t }}</button>
                } @else {
                  <button type="button" class="link" (click)="confirmDelete.set(s.id)">{{ 'common.delete' | t }}</button>
                }
              }
            </td>
          </tr>
        }
      </tbody>
    </table>

    <form class="create" (submit)="create($event)">
      <h2>{{ 'sites.new' | t }}</h2>
      <label class="field">
        <span>{{ 'common.name' | t }}</span>
        <input name="siteName" maxlength="100" [value]="newName()" (input)="newName.set(value($event))" />
      </label>
      <label class="field grow">
        <span>{{ 'common.descriptionOptional' | t }}</span>
        <input name="siteDescription" maxlength="2000" [value]="newDescription()" (input)="newDescription.set(value($event))" />
      </label>
      <button type="submit" [disabled]="!newName().trim()">{{ 'common.create' | t }}</button>
    </form>
  `,
  styles: `
    .intro { max-width: 52rem; margin-top: 0; }
    tr.current td { background: var(--surface-sunken); }
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
      this.message.set({ kind: 'ok', text: t('sites.createdMessage', { name: created.name }) });
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
      this.message.set({ kind: 'ok', text: t('sites.deleted', { name: s.name }) });
    } catch (err) {
      this.message.set({ kind: 'error', text: (err as DeviceApiError).message });
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
