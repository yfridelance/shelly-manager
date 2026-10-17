import { Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { Template } from '../../core/api.types';
import type { DeviceApiError } from '../../core/devices-api';
import { t } from '../../core/i18n/i18n';
import { DateTimePipe, TranslatePipe } from '../../core/i18n/pipes';
import { groupTitles } from '../../core/template-fields';
import { TemplatesApi } from '../../core/templates-api';
import { SiteService } from '../../core/site.service';

@Component({
  selector: 'app-templates-page',
  imports: [DateTimePipe, TranslatePipe, RouterLink],
  template: `
    <div class="head">
      <h1>{{ 'nav.templates' | t }}</h1>
      <span class="spacer"></span>
      <a class="button" routerLink="/templates/neu">{{ 'titles.newTemplate' | t }}</a>
    </div>
    <p class="muted intro">{{ 'templates.intro' | t }}</p>

    @if (message(); as m) {
      <p class="message error" role="alert">{{ m }}</p>
    }

    @if (templates.value().length === 0 && !templates.isLoading()) {
      <p class="muted">{{ 'templates.empty' | t }}</p>
    } @else {
      <table class="data-table">
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
                <a class="button" [routerLink]="['/templates', t.id, 'anwenden']">{{ 'templates.apply' | t }}</a>
                @if (confirmDelete() === t.id) {
                  <span>{{ 'common.deleteQuestion' | t }}</span>
                  <button type="button" class="danger" (click)="remove(t)">{{ 'common.yes' | t }}</button>
                  <button type="button" class="secondary" (click)="confirmDelete.set(null)">{{ 'common.no' | t }}</button>
                } @else {
                  <button type="button" class="link" (click)="confirmDelete.set(t.id)">{{ 'common.delete' | t }}</button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: `
    .head { display: flex; align-items: baseline; gap: 1rem; }
    .spacer { flex: 1; }
    .intro { max-width: 48rem; margin-top: 0; }
    .wrap { white-space: normal; }
    .small { font-size: 0.85rem; }
    .actions { display: flex; gap: 0.5rem; align-items: center; }
  `,
})
export class TemplatesPage {
  private readonly api = inject(TemplatesApi);
  private readonly site = inject(SiteService);
  protected readonly templates = httpResource<Template[]>(() => `/api/templates?site=${this.site.siteId()}`, { defaultValue: [] });
  protected readonly confirmDelete = signal<number | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly groupTitles = groupTitles;

  protected async remove(template: Template): Promise<void> {
    this.confirmDelete.set(null);
    try {
      await this.api.delete(template.id);
      this.templates.reload();
    } catch (err) {
      this.message.set(t('templates.deleteFailed', { error: (err as DeviceApiError).message }));
    }
  }
}
