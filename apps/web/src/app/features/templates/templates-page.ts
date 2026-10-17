import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { Template } from '../../core/api.types';
import type { DeviceApiError } from '../../core/devices-api';
import { groupTitles } from '../../core/template-fields';
import { TemplatesApi } from '../../core/templates-api';
import { SiteService } from '../../core/site.service';

@Component({
  selector: 'app-templates-page',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="head">
      <h1>Templates</h1>
      <span class="spacer"></span>
      <a class="button" routerLink="/templates/neu">Neues Template</a>
    </div>
    <p class="muted intro">
      Ein Template fasst Einstellungen zusammen, die auf mehrere Geräte des aktuellen Standorts angewendet werden, für Gen1 und Gen2+ übersetzt.
      Vor dem Anwenden siehst du pro Gerät, was sich ändert.
    </p>

    @if (message(); as m) {
      <p class="message error" role="alert">{{ m }}</p>
    }

    @if (templates.value().length === 0 && !templates.isLoading()) {
      <p class="muted">Noch keine Templates.</p>
    } @else {
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Einstellungen</th>
            <th>Geändert</th>
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
              <td>{{ t.updatedAt | date: 'dd.MM.yyyy HH:mm' }}</td>
              <td class="actions">
                <a class="button" [routerLink]="['/templates', t.id, 'anwenden']">Anwenden</a>
                @if (confirmDelete() === t.id) {
                  <span>Löschen?</span>
                  <button type="button" class="danger" (click)="remove(t)">Ja</button>
                  <button type="button" class="secondary" (click)="confirmDelete.set(null)">Nein</button>
                } @else {
                  <button type="button" class="link" (click)="confirmDelete.set(t.id)">Löschen</button>
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

  protected async remove(t: Template): Promise<void> {
    this.confirmDelete.set(null);
    try {
      await this.api.delete(t.id);
      this.templates.reload();
    } catch (err) {
      this.message.set(`Löschen fehlgeschlagen: ${(err as DeviceApiError).message}`);
    }
  }
}
