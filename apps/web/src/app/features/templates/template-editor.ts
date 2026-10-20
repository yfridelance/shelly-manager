import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, effect, inject, input, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import type { NetworkSettings, Template, TemplateSettings, WifiInterface } from '../../core/api.types';
import type { DeviceApiError } from '../../core/devices-api';
import { currentLocale, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/pipes';
import {
  SCRIPT_FIELDS,
  TEMPLATE_GROUPS,
  fieldHint,
  fieldText,
  groupGens,
  groupHint,
  groupTitle,
  wifiLabel,
  type TemplateField,
} from '../../core/template-fields';
import { TemplatesApi } from '../../core/templates-api';
import { SiteService } from '../../core/site.service';
import { kernChecked, kernNumber, kernValue, normalizeMask } from '../../core/kern';
import { KernRouterLink } from '../../core/kern-router-link';

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
  imports: [RouterLink, TranslatePipe, KernRouterLink],
  templateUrl: './template-editor.html',
  styleUrl: './template-editor.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class TemplateEditor {
  private readonly api = inject(TemplatesApi);
  private readonly router = inject(Router);
  private readonly site = inject(SiteService);

  /** Route parameter; undefined for a new template. */
  readonly id = input<string>();
  protected readonly groups = TEMPLATE_GROUPS;
  protected readonly scriptFields = SCRIPT_FIELDS;
  protected readonly groupTitle = groupTitle;
  protected readonly groupGens = groupGens;
  protected readonly groupHint = groupHint;
  protected readonly fieldText = fieldText;
  protected readonly fieldHint = fieldHint;

  protected readonly existing = httpResource<Template>(() => (this.id() ? `/api/templates/${this.id()}` : undefined));
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly fields = signal<FieldState>(emptyState());
  protected readonly scriptOn = signal(false);
  protected readonly ifaces: WifiInterface[] = ['sta', 'sta1'];
  protected readonly wifiLabel = wifiLabel;
  protected readonly netOn = signal<Record<WifiInterface, boolean>>({ sta: false, sta1: false });
  protected readonly net = signal<Record<WifiInterface, NetworkSettings>>({ sta: { mode: 'dhcp' }, sta1: { mode: 'dhcp' } });
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
      this.netOn.set({ sta: !!t.settings.network?.sta, sta1: !!t.settings.network?.sta1 });
      this.net.set({ sta: t.settings.network?.sta ?? { mode: 'dhcp' }, sta1: t.settings.network?.sta1 ?? { mode: 'dhcp' } });
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
    const network: Record<string, NetworkSettings> = {};
    for (const iface of this.ifaces) {
      if (!this.netOn()[iface]) continue;
      const n = this.net()[iface];
      const v = (x: string | undefined) => x?.trim() || undefined;
      network[iface] =
        n.mode === 'dhcp'
          ? { mode: 'dhcp' }
          : Object.fromEntries(
              Object.entries({ mode: 'static', ipFrom: v(n.ipFrom), netmask: normalizeMask(v(n.netmask)), gateway: v(n.gateway), dns: v(n.dns) }).filter(
                ([, value]) => value !== undefined,
              ),
            ) as unknown as NetworkSettings;
    }
    if (Object.keys(network).length > 0) out['network'] = network;
    return out as TemplateSettings;
  });

  protected readonly canSave = computed(() => {
    const s = this.settings();
    const script = s.script;
    const networkOk = Object.values(s.network ?? {}).every((n) => n.mode === 'dhcp' || (!!n.ipFrom && !!n.netmask));
    return (
      this.name().trim() !== '' &&
      Object.keys(s).length > 0 &&
      (!script || (script.name !== '' && script.code.trim() !== '')) &&
      networkOk
    );
  });

  protected toggle(key: string, on: boolean): void {
    this.fields.update((s) => ({ ...s, [key]: { value: s[key]?.value ?? '', on } }));
  }

  protected toggleNet(iface: WifiInterface, on: boolean): void {
    this.netOn.update((s) => ({ ...s, [iface]: on }));
  }

  /** Any input includes the interface in the template. */
  protected setNet(iface: WifiInterface, key: keyof NetworkSettings, value: string): void {
    this.net.update((s) => ({ ...s, [iface]: { ...s[iface], [key]: value } }));
    this.netOn.update((s) => ({ ...s, [iface]: true }));
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
      const saved = id ? await this.api.update(Number(id), input) : await this.api.create({ ...input, siteId: this.site.siteId() });
      void this.router.navigate(['/templates', saved.id, 'anwenden']);
    } catch (err) {
      this.error.set(t('device.saveFailed', { error: (err as DeviceApiError).message }));
    } finally {
      this.saving.set(false);
    }
  }

  protected readonly value = kernValue;
  protected readonly checked = kernChecked;
  protected readonly locale = currentLocale;

  /** Field values are kept as text; kern-step-input works with numbers ('' = empty). */
  protected numberValue(text: string | undefined): number | '' {
    return text === undefined || text.trim() === '' || !Number.isFinite(Number(text)) ? '' : Number(text);
  }

  protected numberText(event: Event): string {
    const n = kernNumber(event);
    return n === null ? '' : String(n);
  }
}
