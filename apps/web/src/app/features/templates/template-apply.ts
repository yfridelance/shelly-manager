import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { ApplyTemplateResult, Device, Template, TemplatePreview } from '../../core/api.types';
import type { DeviceApiError } from '../../core/devices-api';
import { describeSettings, itemText } from '../../core/template-fields';
import { errorText, formatMac } from '../../core/texts';
import { TemplatesApi, type ApplyRequest } from '../../core/templates-api';

const CONCURRENCY = 4;

interface RowResult {
  ok: boolean;
  text: string;
  result?: ApplyTemplateResult;
}

/**
 * Apply one template to several devices: preview per device (from the newest snapshot, no device
 * contact), one confirmation, then one request per device with limited parallelism. Each device
 * takes its own snapshot first on the server and fails on its own.
 */
@Component({
  selector: 'app-template-apply',
  imports: [DatePipe, RouterLink],
  templateUrl: './template-apply.html',
  styleUrl: './template-apply.scss',
})
export class TemplateApply {
  private readonly api = inject(TemplatesApi);
  readonly id = input.required<string>();

  protected readonly formatMac = formatMac;
  protected readonly itemText = itemText;

  protected readonly template = httpResource<Template>(() => `/api/templates/${this.id()}`);
  protected readonly devices = httpResource<Device[]>(() => '/api/devices', { defaultValue: [] });
  protected readonly previews = signal<Record<string, TemplatePreview>>({});
  protected readonly lines = computed(() => (this.template.hasValue() ? describeSettings(this.template.value().settings) : []));
  protected readonly needsMqttPassword = computed(() => this.template.hasValue() && this.template.value().settings.mqtt !== undefined);
  protected readonly needsApPassword = computed(() => this.template.hasValue() && this.template.value().settings.wifiAp?.enable === true);

  /** Only active devices with an IP can be configured. */
  protected readonly candidates = computed(() => this.devices.value().filter((d) => d.state === 'active' && d.ip !== null));
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly expanded = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly visible = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.candidates().filter((d) => !q || [d.name, d.mac, d.ip, d.model, d.location].some((v) => v?.toLowerCase().includes(q)));
  });
  protected readonly selectedDevices = computed(() => this.candidates().filter((d) => this.selected().has(d.mac)));
  protected readonly selectedProtected = computed(() => this.selectedDevices().filter((d) => d.authRequired));

  // Secrets: only in these fields until the run starts, then only in the run's closure.
  protected readonly username = signal('admin');
  protected readonly password = signal('');
  protected readonly mqttPassword = signal('');
  protected readonly apPassword = signal('');
  protected readonly reboot = signal(true);

  protected readonly confirming = signal(false);
  protected readonly running = signal(false);
  protected readonly results = signal<Record<string, RowResult>>({});
  protected readonly doneCount = computed(() => Object.keys(this.results()).length);
  protected readonly total = signal(0);
  private cancelled = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.cancelled = true));
    // Preview for all active devices once the template is known.
    effect(() => {
      if (!this.template.hasValue()) return;
      void this.api.preview(this.template.value().id).then(
        (list) => this.previews.set(Object.fromEntries(list.map((p) => [p.mac, p]))),
        () => this.previews.set({}),
      );
    });
  }

  protected summary(mac: string): { text: string; kind: 'change' | 'same' | 'unknown' | 'unsupported' } {
    const p = this.previews()[mac];
    if (!p || p.basedOn === null) return { text: 'kein Snapshot, wird beim Anwenden ermittelt', kind: 'unknown' };
    const changes = p.items.filter((i) => i.status === 'change').length;
    const unsupported = p.items.filter((i) => i.status === 'unsupported').length;
    const parts: string[] = [];
    if (changes > 0) parts.push(`${changes} ${changes === 1 ? 'Änderung' : 'Änderungen'}`);
    if (unsupported > 0) parts.push(`${unsupported} nicht unterstützt`);
    if (parts.length === 0) return { text: 'keine Änderung', kind: 'same' };
    return { text: parts.join(', '), kind: changes > 0 ? 'change' : 'unsupported' };
  }

  protected toggle(mac: string, on: boolean): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (on) next.add(mac);
      else next.delete(mac);
      return next;
    });
  }

  protected selectAll(on: boolean): void {
    this.selected.set(on ? new Set(this.visible().map((d) => d.mac)) : new Set());
  }

  /** Select exactly the devices whose preview shows changes (or that have no snapshot yet). */
  protected selectChanging(): void {
    this.selected.set(new Set(this.candidates().filter((d) => this.summary(d.mac).kind !== 'same').map((d) => d.mac)));
  }

  protected async run(): Promise<void> {
    if (!this.template.hasValue()) return;
    this.confirming.set(false);
    const templateId = this.template.value().id;
    const devices = this.selectedDevices();
    const password = this.password();
    const username = this.username().trim();
    const secrets = {
      ...(this.mqttPassword() ? { mqttPassword: this.mqttPassword() } : {}),
      ...(this.apPassword() ? { apPassword: this.apPassword() } : {}),
    };
    this.password.set('');
    this.mqttPassword.set('');
    this.apPassword.set('');
    const rebootIfRequired = this.reboot();

    this.cancelled = false;
    this.results.set({});
    this.total.set(devices.length);
    this.running.set(true);
    let next = 0;
    const lane = async (): Promise<void> => {
      while (!this.cancelled && next < devices.length) {
        const d = devices[next++] as Device;
        const request: ApplyRequest = {
          templateId,
          rebootIfRequired,
          ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
          ...(d.authRequired && password ? { credentials: { password, ...(d.gen === 1 && username ? { username } : {}) } } : {}),
        };
        let row: RowResult;
        try {
          const result = await this.api.apply(d.mac, request);
          row = { ok: true, result, text: resultText(result) };
        } catch (err) {
          const e = err as DeviceApiError;
          row = { ok: false, text: e.causeCode ? `${e.message}: ${errorText(e.causeCode)}` : e.message };
        }
        if (this.cancelled) return;
        this.results.update((r) => ({ ...r, [d.mac]: row }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, devices.length) }, lane));
    this.running.set(false);
    // Previews now reflect the new snapshots.
    void this.api.preview(templateId).then((list) => this.previews.set(Object.fromEntries(list.map((p) => [p.mac, p]))));
  }

  protected cancel(): void {
    this.cancelled = true;
    this.running.set(false);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected okCount(): number {
    return Object.values(this.results()).filter((r) => r.ok).length;
  }
}

function resultText(r: ApplyTemplateResult): string {
  if (r.changed === 0) return 'keine Änderung nötig';
  const parts = [`${r.changed} ${r.changed === 1 ? 'Einstellung' : 'Einstellungen'} geändert`];
  if (r.rebooted) parts.push('neu gestartet');
  else if (r.restartRequired) parts.push('Neustart nötig');
  return parts.join(', ');
}
