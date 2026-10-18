import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Device } from '../../core/api.types';
import { DeviceApiError, DevicesApi, type Credentials } from '../../core/devices-api';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/pipes';
import { shortFirmware } from '../../core/texts';

const CONCURRENCY = 6;

export interface FirmwareCheckResult {
  mac: string;
  name: string | null;
  outcome: 'update' | 'current' | 'skipped' | 'error';
  stable: string | null;
  beta: string | null;
  checkedAt: string | null;
  error: string | null;
}

/**
 * Checks all active devices for firmware updates (read-only, so a bulk run is fine).
 * Uses the per-device endpoint with limited parallelism; protected devices are only
 * checked when a password is given, and the password lives only for this run.
 */
@Component({
  selector: 'app-firmware-check-panel',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './firmware-check-panel.html',
  styleUrl: './firmware-check-panel.scss',
})
export class FirmwareCheckPanel {
  private readonly api = inject(DevicesApi);
  readonly devices = input.required<Device[]>();
  /** Fires per checked device so the inventory can update its rows live. */
  readonly checked = output<FirmwareCheckResult>();
  readonly showUpdates = output<void>();

  protected readonly shortFirmware = shortFirmware;
  protected readonly open = signal(false);
  protected readonly username = signal('admin');
  protected readonly password = signal('');
  protected readonly running = signal(false);
  protected readonly total = signal(0);
  protected readonly results = signal<FirmwareCheckResult[]>([]);
  private cancelled = false;

  /** Only devices that can be reached: active and with a known IP. */
  protected readonly candidates = computed(() => this.devices().filter((d) => d.state === 'active' && d.ip !== null));
  protected readonly protectedCount = computed(() => this.candidates().filter((d) => d.authRequired).length);
  protected readonly done = computed(() => this.results().length);
  protected readonly finished = computed(() => !this.running() && this.results().length > 0);
  protected readonly count = (outcome: FirmwareCheckResult['outcome']) => this.results().filter((r) => r.outcome === outcome).length;
  protected readonly betaCount = computed(() => this.results().filter((r) => r.beta !== null).length);
  protected readonly problems = computed(() => this.results().filter((r) => r.outcome === 'error' || r.outcome === 'skipped'));

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.cancelled = true));
  }

  protected toggle(): void {
    if (this.running()) return;
    this.open.update((o) => !o);
    if (!this.open()) this.reset();
  }

  protected async start(event: Event): Promise<void> {
    event.preventDefault();
    const password = this.password();
    this.password.set('');
    const username = this.username().trim();
    const devices = this.candidates();

    this.cancelled = false;
    this.results.set([]);
    this.total.set(devices.length);
    this.running.set(true);

    let next = 0;
    const lane = async (): Promise<void> => {
      while (!this.cancelled && next < devices.length) {
        const device = devices[next++] as Device;
        const result = await this.checkOne(device, password, username);
        if (this.cancelled) return;
        this.results.update((r) => [...r, result]);
        this.checked.emit(result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, devices.length) }, lane));
    this.running.set(false);
  }

  protected cancel(): void {
    this.cancelled = true;
    this.running.set(false);
  }

  protected close(): void {
    this.open.set(false);
    this.reset();
  }

  private reset(): void {
    this.results.set([]);
    this.total.set(0);
    this.password.set('');
  }

  private async checkOne(device: Device, password: string, username: string): Promise<FirmwareCheckResult> {
    const base = { mac: device.mac, name: device.name, stable: null, beta: null, checkedAt: null, error: null };
    if (device.authRequired && !password) return { ...base, outcome: 'skipped', error: t('firmwareCheck.skippedNoPassword') };
    const credentials: Credentials | undefined = device.authRequired
      ? { password, ...(device.gen === 1 && username ? { username } : {}) }
      : undefined;
    try {
      const r = await this.api.checkFirmware(device.mac, credentials);
      return { ...base, outcome: r.stable ? 'update' : 'current', stable: r.stable, beta: r.beta, checkedAt: r.checkedAt };
    } catch (err) {
      return { ...base, outcome: 'error', error: (err as DeviceApiError).message };
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
