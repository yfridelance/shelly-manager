import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import type { Template, TemplateSettings } from '../../core/api.types';
import type { DeviceApiError } from '../../core/devices-api';
import { SCRIPT_FIELDS, TEMPLATE_GROUPS, type TemplateField } from '../../core/template-fields';
import { TemplatesApi } from '../../core/templates-api';

/** Per field: included in the template, and its raw input value ('true'/'false' for booleans). */
type FieldState = Record<string, { on: boolean; value: string }>;

function emptyState(): FieldState {
  const state: FieldState = {};
  for (const g of TEMPLATE_GROUPS) for (const f of g.fields) state[f.key] = { on: false, value: f.type === 'bool' ? 'true' : '' };
  for (const f of SCRIPT_FIELDS) state[f.key] = { on: false, value: f.type === 'bool' ? 'true' : '' };
  return state;
}

function stateFromSettings(settings: TemplateSettings): FieldState {
  const state = emptyState();
  const get = (key: string) =>
    key.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), settings);
  for (const key of Object.keys(state)) {
    const v = get(key);
    if (v !== undefined) state[key] = { on: true, value: String(v) };
  }
  return state;
}

@Component({
  selector: 'app-template-editor',
  imports: [RouterLink],
  templateUrl: './template-editor.html',
  styleUrl: './template-editor.scss',
})
export class TemplateEditor {
  private readonly api = inject(TemplatesApi);
  private readonly router = inject(Router);

  /** Route parameter; undefined for a new template. */
  readonly id = input<string>();
  protected readonly groups = TEMPLATE_GROUPS;
  protected readonly scriptFields = SCRIPT_FIELDS;

  protected readonly existing = httpResource<Template>(() => (this.id() ? `/api/templates/${this.id()}` : undefined));
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly fields = signal<FieldState>(emptyState());
  protected readonly scriptOn = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (!this.existing.hasValue()) return;
      const t = this.existing.value();
      this.name.set(t.name);
      this.description.set(t.description ?? '');
      this.fields.set(stateFromSettings(t.settings));
      this.scriptOn.set(t.settings.script !== undefined);
    });
  }

  protected readonly settings = computed<TemplateSettings>(() => {
    const state = this.fields();
    const out: Record<string, Record<string, unknown>> = {};
    const all: TemplateField[] = [...this.groups.flatMap((g) => g.fields)];
    for (const f of all) {
      const s = state[f.key];
      if (!s?.on) continue;
      const [group = '', key = ''] = f.key.split('.');
      const value = f.type === 'bool' ? s.value === 'true' : f.type === 'number' ? Number(s.value) : s.value.trim();
      if (f.type !== 'bool' && (s.value.trim() === '' || (f.type === 'number' && Number.isNaN(value)))) continue;
      (out[group] ??= {})[key] = value;
    }
    if (this.scriptOn()) {
      const v = (k: string) => state[`script.${k}`]?.value ?? '';
      out['script'] = { name: v('name').trim(), code: v('code'), enable: v('enable') === 'true', start: v('start') === 'true' };
    }
    return out as TemplateSettings;
  });

  protected readonly canSave = computed(() => {
    const s = this.settings();
    const script = s.script;
    return this.name().trim() !== '' && Object.keys(s).length > 0 && (!script || (script.name !== '' && script.code.trim() !== ''));
  });

  protected toggle(key: string, on: boolean): void {
    this.fields.update((s) => ({ ...s, [key]: { value: s[key]?.value ?? '', on } }));
  }

  protected setValue(key: string, value: string): void {
    this.fields.update((s) => ({ ...s, [key]: { on: true, value } }));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    const input = { name: this.name().trim(), description: this.description().trim() || null, settings: this.settings() };
    try {
      const id = this.id();
      const saved = id ? await this.api.update(Number(id), input) : await this.api.create(input);
      void this.router.navigate(['/templates', saved.id, 'anwenden']);
    } catch (err) {
      this.error.set(`Speichern fehlgeschlagen: ${(err as DeviceApiError).message}`);
    } finally {
      this.saving.set(false);
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
