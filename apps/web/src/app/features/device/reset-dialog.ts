import { Component, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import type { Device } from '../../core/api.types';
import { DeviceApiError, DevicesApi, type FactoryResetResult } from '../../core/devices-api';
import { t } from '../../core/i18n/i18n';
import { EmphasisPipe, TranslatePipe } from '../../core/i18n/pipes';
import { errorText, formatMac } from '../../core/texts';

/**
 * Factory reset of exactly one device (AGENTS.md section 9): MAC or name must be typed,
 * the server takes a snapshot first and blocks on failure unless the override is ticked.
 */
@Component({
  selector: 'app-reset-dialog',
  imports: [TranslatePipe, EmphasisPipe],
  templateUrl: './reset-dialog.html',
  styleUrl: './reset-dialog.scss',
  host: { '(document:keydown.escape)': 'close()' },
})
export class ResetDialog {
  private readonly api = inject(DevicesApi);
  readonly device = input.required<Device>();
  readonly closed = output<void>();
  readonly resetDone = output<FactoryResetResult>();

  protected readonly formatMac = formatMac;
  protected readonly confirmation = signal('');
  protected readonly username = signal('admin');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Set after the server refused because the pre-reset snapshot failed. */
  protected readonly snapshotFailure = signal<string | null>(null);
  protected readonly override = signal(false);

  private readonly confirmInput = viewChild<ElementRef<HTMLInputElement>>('confirmInput');

  /** Typed MAC (any separators/case) or the exact device name (case-insensitive). */
  protected readonly confirmed = computed(() => {
    const typed = this.confirmation().trim();
    const d = this.device();
    if (!typed) return false;
    const asMac = typed.replace(/[:\-.\s]/g, '').toUpperCase();
    return asMac === d.mac || (!!d.name && typed.toLowerCase() === d.name.trim().toLowerCase());
  });

  protected readonly canSubmit = computed(
    () =>
      this.confirmed() &&
      !this.busy() &&
      (!this.device().authRequired || this.password() !== '') &&
      (this.snapshotFailure() === null || this.override()),
  );

  constructor() {
    afterNextRender(() => this.confirmInput()?.nativeElement.focus());
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit()) return;
    const d = this.device();
    const password = this.password();
    this.password.set('');
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.factoryReset(d.mac, {
        confirmMac: d.mac,
        ...(d.authRequired ? { credentials: { password, ...(d.gen === 1 ? { username: this.username().trim() } : {}) } } : {}),
        ...(this.override() ? { allowWithoutSnapshot: true } : {}),
      });
      this.resetDone.emit(result);
    } catch (err) {
      const e = err as DeviceApiError;
      if (e.code === 'snapshot_failed') {
        this.snapshotFailure.set(errorText(e.causeCode));
      } else {
        this.error.set(t('reset.failed', { error: e.message }));
      }
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    if (!this.busy()) this.closed.emit();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
