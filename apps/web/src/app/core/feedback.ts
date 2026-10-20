import { Injectable } from '@angular/core';
import { confirm, setToastRegionLabel, toast } from '@yfridelance/kern/components';
import { t } from './i18n/i18n';

export interface ConfirmRequest {
  heading: string;
  message?: string;
  /** Text of the confirm button, e.g. «Ja, neu starten». */
  confirmLabel: string;
  /** Confirm button in danger style (actions that interrupt the device). */
  danger?: boolean;
}

/**
 * Confirmations and short success messages through Kern's `confirm()` and `toast()`, with translated labels.
 * A service (not the functions directly) so tests can replace it: in jsdom the Kern elements are not defined
 * and `confirm()` would never resolve. Errors stay inline as kern-alert, they are not toasts.
 */
@Injectable({ providedIn: 'root' })
export class Feedback {
  /** Modal question; resolves `true` only when the user confirmed. */
  confirm(request: ConfirmRequest): Promise<boolean> {
    return confirm({ ...request, cancelLabel: t('common.cancel') });
  }

  /** Short success message at the bottom right that closes itself. */
  success(message: string): void {
    // Set on every toast, so a language switch reaches the shared live region too.
    setToastRegionLabel(t('common.notifications'));
    void toast({ message, tone: 'ok', closeLabel: t('common.close') });
  }
}
