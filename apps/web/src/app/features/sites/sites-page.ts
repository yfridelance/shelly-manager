import { CUSTOM_ELEMENTS_SCHEMA, Component, inject, signal } from '@angular/core';
import type { Site } from '../../core/api.types';
import { t } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import type { DeviceApiError } from '../../core/devices-api';
import { SiteService, SitesStore } from '../../core/site.service';
import { SitesApi } from '../../core/sites-api';
import { EditableField } from '../../shared/editable-field';
import { kernValue } from '../../core/kern';
import { Feedback } from '../../core/feedback';

/** Sites (houses, customers): each has its own inventory, templates and log. */
@Component({
  selector: 'app-sites-page',
  imports: [DateTimePipe, TranslatePipe, EditableField],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <kern-page-header [heading]="'nav.sites' | t" [description]="'sites.intro' | t" />

    @if (error(); as e) {
      <kern-alert tone="danger" role="alert">{{ e }}</kern-alert>
    }

    <kern-table>
    <table>
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
                <kern-badge tone="accent">{{ 'sites.current' | t }}</kern-badge>
              } @else {
                <kern-button size="sm" variant="ghost" (click)="site.select(s.id)">{{ 'sites.switch' | t }}</kern-button>
              }
              @if (s.deviceCount === 0 && s.templateCount === 0 && sites.list.value().length > 1) {
                <kern-button size="sm" variant="ghost" (click)="remove(s)">{{ 'common.delete' | t }}</kern-button>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
    </kern-table>

    <kern-card class="create" [heading]="'sites.new' | t">
      <form (submit)="create($event)">
        <kern-input name="siteName" [label]="'common.name' | t" [value]="newName()" (kernInput)="newName.set(value($event))" />
        <kern-input name="siteDescription" class="grow" [label]="'common.descriptionOptional' | t" [value]="newDescription()" (kernInput)="newDescription.set(value($event))" />
        <kern-button type="submit" variant="primary" [disabled]="!newName().trim()">{{ 'common.create' | t }}</kern-button>
      </form>
    </kern-card>
  `,
  styles: `
    kern-alert { margin-bottom: var(--space-4); }
    tr.current td { background: var(--accent-soft); }
    .actions { display: flex; gap: var(--space-2); align-items: center; }
    .create { display: block; margin-top: var(--space-5); max-width: 52rem; }
    .create form { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-4); }
    .grow { flex: 1 1 18rem; }
  `,
})
export class SitesPage {
  private readonly api = inject(SitesApi);
  protected readonly sites = inject(SitesStore);
  protected readonly site = inject(SiteService);
  protected readonly newName = signal('');
  protected readonly newDescription = signal('');
  private readonly feedback = inject(Feedback);
  protected readonly error = signal<string | null>(null);

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    try {
      const created = await this.api.create({ name: this.newName().trim(), description: this.newDescription().trim() || null });
      this.newName.set('');
      this.newDescription.set('');
      this.sites.list.reload();
      this.error.set(null);
      this.feedback.success(t('sites.createdMessage', { name: created.name }));
    } catch (err) {
      this.error.set((err as DeviceApiError).message);
    }
  }

  protected async rename(s: Site, name: string, description: string | null): Promise<void> {
    if (!name.trim()) return;
    try {
      await this.api.update(s.id, { name: name.trim(), description: description?.trim() || null });
      this.sites.list.reload();
    } catch (err) {
      this.error.set((err as DeviceApiError).message);
    }
  }

  protected async remove(s: Site): Promise<void> {
    const ok = await this.feedback.confirm({ heading: t('common.deleteNamed', { name: s.name }), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      await this.api.delete(s.id);
      this.sites.list.reload();
      this.error.set(null);
      this.feedback.success(t('sites.deleted', { name: s.name }));
    } catch (err) {
      this.error.set((err as DeviceApiError).message);
    }
  }

  protected readonly value = kernValue;
}
