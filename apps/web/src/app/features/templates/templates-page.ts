import { CUSTOM_ELEMENTS_SCHEMA, Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { Template } from '../../core/api.types';
import type { DeviceApiError } from '../../core/devices-api';
import { t } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import { groupTitles } from '../../core/template-fields';
import { TemplatesApi } from '../../core/templates-api';
import { SiteService } from '../../core/site.service';
import { Feedback } from '../../core/feedback';

@Component({
  selector: 'app-templates-page',
  imports: [DateTimePipe, TranslatePipe, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <kern-page-header [heading]="'nav.templates' | t" [description]="'templates.intro' | t">
      <a slot="actions" class="button" routerLink="/templates/neu">{{ 'titles.newTemplate' | t }}</a>
    </kern-page-header>

    @if (message(); as m) {
      <kern-alert tone="danger" role="alert">{{ m }}</kern-alert>
    }

    @if (templates.value().length === 0 && !templates.isLoading()) {
      <p class="muted">{{ 'templates.empty' | t }}</p>
    } @else {
      <kern-table>
      <table>
        <thead>
          <tr>
            <th>{{ 'common.name' | t }}</th>
            <th>{{ 'templates.settings' | t }}</th>
            <th>{{ 'templates.changed' | t }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (t of templates.value(); track t.id) {
            <tr>
              <td>
                <a [routerLink]="['/templates', t.id]">{{ t.name }}</a>
                @if (t.description) {
                  <div class="muted small">{{ t.description }}</div>
                }
              </td>
              <td class="wrap">{{ groupTitles(t.settings).join(', ') }}</td>
              <td>{{ t.updatedAt | dateTime }}</td>
              <td class="actions">
                <a class="button secondary sm" [routerLink]="['/templates', t.id, 'anwenden']">{{ 'templates.apply' | t }}</a>
                <kern-button size="sm" variant="ghost" (click)="remove(t)">{{ 'common.delete' | t }}</kern-button>
              </td>
            </tr>
          }
        </tbody>
      </table>
      </kern-table>
    }
  `,
  styles: `
    kern-alert { margin-bottom: var(--space-4); }
    .wrap { white-space: normal; }
    .small { font-size: 0.85rem; }
    .actions { display: flex; gap: var(--space-2); align-items: center; }
  `,
})
export class TemplatesPage {
  private readonly api = inject(TemplatesApi);
  private readonly site = inject(SiteService);
  protected readonly templates = httpResource<Template[]>(() => `/api/templates?site=${this.site.siteId()}`, { defaultValue: [] });
  private readonly feedback = inject(Feedback);
  protected readonly message = signal<string | null>(null);
  protected readonly groupTitles = groupTitles;

  protected async remove(template: Template): Promise<void> {
    const ok = await this.feedback.confirm({ heading: t('common.deleteNamed', { name: template.name }), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      await this.api.delete(template.id);
      this.message.set(null);
      this.templates.reload();
      this.feedback.success(t('templates.deleted', { name: template.name }));
    } catch (err) {
      this.message.set(t('templates.deleteFailed', { error: (err as DeviceApiError).message }));
    }
  }
}
