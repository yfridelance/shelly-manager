import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { ApplyTemplateResult, Device, Template, TemplatePreview, WifiInterface } from '../../core/api.types';
import { ipChangeText } from '../../core/action-text';
import type { DeviceApiError } from '../../core/devices-api';
import { WIFI_LABEL, describeSettings, itemText } from '../../core/template-fields';
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
  // Only devices of the template's site can be configured with it.
  protected readonly devices = httpResource<Device[]>(
    () => (this.template.hasValue() ? `/api/devices?site=${this.template.value().siteId}` : undefined),
    { defaultValue: [] },
  );
  protected readonly previews = signal<Record<string, TemplatePreview>>({});
  protected readonly lines = computed(() => (this.template.hasValue() ? describeSettings(this.template.value().settings) : []));
  protected readonly needsMqttPassword = computed(() => this.template.hasValue() && this.template.value().settings.mqtt !== undefined);
  protected readonly needsApPassword = computed(() => this.template.hasValue() && this.template.value().settings.wifiAp?.enable === true);
  protected readonly wifiLabel = WIFI_LABEL;
  /** WLAN interfaces with static addressing in this template (each gets an IP column). */
  protected readonly staticIfaces = computed<WifiInterface[]>(() => {
    const net = this.template.hasValue() ? this.template.value().settings.network : undefined;
    return (['sta', 'sta1'] as const).filter((i) => net?.[i]?.mode === 'static');
  });
  protected readonly hasNetwork = computed(() => this.template.hasValue() && !!this.template.value().settings.network);
  /** IPs edited by hand, per device and interface; otherwise the planned ones from the preview are used. */
  protected readonly ipOverrides = signal<Record<string, Partial<Record<WifiInterface, string>>>>({});
  private previewTimer: ReturnType<typeof setTimeout> | undefined;

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
    // Static IPs are planned for the selection: re-plan when it changes, so the addresses stay contiguous.
    effect(() => {
      const macs = [...this.selected()];
      if (this.staticIfaces().length === 0 || macs.length === 0 || !this.template.hasValue()) return;
      const id = this.template.value().id;
      clearTimeout(this.previewTimer);
      this.previewTimer = setTimeout(() => {
        void this.api.preview(id, macs).then((list) => this.previews.update((p) => ({ ...p, ...Object.fromEntries(list.map((x) => [x.mac, x])) })));
      }, 300);
    });
  }

  /** IP that will be sent for this device and interface: edited by hand or planned. */
  protected plannedIp(mac: string, iface: WifiInterface): string {
    return this.ipOverrides()[mac]?.[iface] ?? this.previews()[mac]?.assignedIps[iface] ?? '';
  }

  protected setIp(mac: string, iface: WifiInterface, ip: string): void {
    this.ipOverrides.update((o) => ({ ...o, [mac]: { ...o[mac], [iface]: ip.trim() } }));
  }

  /** CSV for DHCP reservations in the router: MAC → planned IP, for the selected devices. */
  protected exportReservations(): void {
    const iface = this.staticIfaces()[0] ?? 'sta';
    const rows = this.selectedDevices().map((d) => [d.name ?? '', d.deviceId ?? '', formatMac(d.mac), this.plannedIp(d.mac, iface)]);
    const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = '\uFEFF' + [['Name', 'Geräte-ID', 'MAC', 'IP'], ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dhcp-reservierungen-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  /**
   * Select exactly the devices whose preview shows changes, or that have no snapshot yet (unknown).
   * Devices with only unsupported settings have nothing to change and stay unselected.
   */
  protected selectChanging(): void {
    this.selected.set(
      new Set(this.candidates().filter((d) => ['change', 'unknown'].includes(this.summary(d.mac).kind)).map((d) => d.mac)),
    );
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
        const network = Object.fromEntries(
          this.staticIfaces().flatMap((i) => (this.plannedIp(d.mac, i) ? [[i, this.plannedIp(d.mac, i)]] : [])),
        ) as Partial<Record<WifiInterface, string>>;
        const request: ApplyRequest = {
          templateId,
          rebootIfRequired,
          ...(Object.keys(network).length > 0 ? { network } : {}),
          ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
          ...(d.authRequired && password ? { credentials: { password, ...(d.gen === 1 && username ? { username } : {}) } } : {}),
        };
        let row: RowResult;
        try {
          const result = await this.api.apply(d.mac, request);
          row = { ok: !result.network || result.network.confirmed, result, text: resultText(result) };
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
  if (r.network) {
    parts.push(
      r.network.ip === null
        ? ipChangeText({ from: null, to: null, confirmed: false, dhcp: true })
        : r.network.confirmed
          ? `jetzt unter ${r.network.ip}`
          : `unter ${r.network.ip} nicht erreichbar – bitte neu scannen`,
    );
  }
  if (r.rebooted) parts.push('neu gestartet');
  else if (r.restartRequired) parts.push('Neustart nötig');
  return parts.join(', ');
}
