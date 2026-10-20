import { initTheme, parseIpv4 } from '@yfridelance/kern/components';
import { defineCustomElement as alert } from '@yfridelance/kern/components/kern-alert.js';
import { defineCustomElement as badge } from '@yfridelance/kern/components/kern-badge.js';
import { defineCustomElement as button } from '@yfridelance/kern/components/kern-button.js';
import { defineCustomElement as card } from '@yfridelance/kern/components/kern-card.js';
import { defineCustomElement as checkbox } from '@yfridelance/kern/components/kern-checkbox.js';
import { defineCustomElement as copy } from '@yfridelance/kern/components/kern-copy.js';
import { defineCustomElement as dialog } from '@yfridelance/kern/components/kern-dialog.js';
import { defineCustomElement as input } from '@yfridelance/kern/components/kern-input.js';
import { defineCustomElement as ipInput } from '@yfridelance/kern/components/kern-ip-input.js';
import { defineCustomElement as json } from '@yfridelance/kern/components/kern-json.js';
import { defineCustomElement as kv } from '@yfridelance/kern/components/kern-kv.js';
import { defineCustomElement as kvItem } from '@yfridelance/kern/components/kern-kv-item.js';
import { defineCustomElement as pageHeader } from '@yfridelance/kern/components/kern-page-header.js';
import { defineCustomElement as progress } from '@yfridelance/kern/components/kern-progress.js';
import { defineCustomElement as segmented } from '@yfridelance/kern/components/kern-segmented.js';
import { defineCustomElement as select } from '@yfridelance/kern/components/kern-select.js';
import { defineCustomElement as signal } from '@yfridelance/kern/components/kern-signal.js';
import { defineCustomElement as spinner } from '@yfridelance/kern/components/kern-spinner.js';
import { defineCustomElement as status } from '@yfridelance/kern/components/kern-status.js';
import { defineCustomElement as stepInput } from '@yfridelance/kern/components/kern-step-input.js';
import { defineCustomElement as switchEl } from '@yfridelance/kern/components/kern-switch.js';
import { defineCustomElement as tabPanel } from '@yfridelance/kern/components/kern-tab-panel.js';
import { defineCustomElement as table } from '@yfridelance/kern/components/kern-table.js';
import { defineCustomElement as tabs } from '@yfridelance/kern/components/kern-tabs.js';
import { defineCustomElement as toast } from '@yfridelance/kern/components/kern-toast.js';
import { defineCustomElement as textarea } from '@yfridelance/kern/components/kern-textarea.js';
import { defineCustomElement as themeToggle } from '@yfridelance/kern/components/kern-theme-toggle.js';
import { defineCustomElement as toolbar } from '@yfridelance/kern/components/kern-toolbar.js';
import { defineCustomElement as topbar } from '@yfridelance/kern/components/kern-topbar.js';

/** Registers the Kern elements the app uses and applies the remembered theme (dark by default). */
export function defineKern(): void {
  initTheme();
  for (const define of [
    alert, badge, button, card, checkbox, copy, dialog, input, ipInput, json, kv, kvItem, pageHeader, progress, segmented,
    select, signal, spinner, status, stepInput, switchEl, tabPanel, table, tabs, textarea, themeToggle, toast, toolbar, topbar,
  ]) {
    define();
  }
}

/** Value from a Kern field event (`kernInput` / `kernChange` of kern-input, kern-select, kern-segmented …). */
export function kernValue(event: Event): string {
  const detail = (event as CustomEvent<{ value?: string } | undefined>).detail;
  return detail?.value ?? (event.target as { value?: string } | null)?.value ?? '';
}

/** Checked state from a `kernChange` of kern-switch / kern-checkbox. */
export function kernChecked(event: Event): boolean {
  const detail = (event as CustomEvent<{ checked?: boolean } | undefined>).detail;
  return detail?.checked ?? !!(event.target as { checked?: boolean } | null)?.checked;
}

/** Number from a `kernChange` of kern-step-input; null when the field is empty. */
export function kernNumber(event: Event): number | null {
  const detail = (event as CustomEvent<{ value?: number | null } | undefined>).detail;
  const value = detail?.value ?? (event.target as { value?: number | '' } | null)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Normalised IPv4 text as kern-ip-input shows it after leaving the field (`10.0.0.1-50` → `10.0.0.1-10.0.0.50`),
 * so a value submitted right after typing has the form the server expects. Invalid text stays as it is.
 */
export function normalizeIp(text: string): string {
  return parseIpv4(text)?.value ?? text.trim();
}
