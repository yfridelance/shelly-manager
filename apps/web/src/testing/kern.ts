// Test helpers: Kern elements are not upgraded in jsdom, so tests set the property and fire the Kern event.

function find(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`${selector} missing`);
  return el;
}

const TYPED = new Set(['kern-input', 'kern-textarea', 'kern-ip-input']);

/**
 * Types into a kern-input / kern-textarea / kern-ip-input (`kernInput`), picks in a kern-select / kern-segmented
 * (`kernChange`) or commits a number in a kern-step-input (`kernChange` with a number, '' = empty).
 */
export function setKernValue(root: ParentNode, selector: string, value: string): void {
  const el = find(root, selector) as HTMLElement & { value: string | number };
  if (el.localName === 'kern-step-input') {
    const n = value.trim() === '' ? null : Number(value);
    el.value = n ?? '';
    el.dispatchEvent(new CustomEvent('kernChange', { detail: { value: n } }));
    return;
  }
  el.value = value;
  el.dispatchEvent(new CustomEvent(TYPED.has(el.localName) ? 'kernInput' : 'kernChange', { detail: { value } }));
}

/** Toggles a kern-switch / kern-checkbox. */
export function setKernChecked(root: ParentNode, selector: string, checked: boolean): void {
  const el = find(root, selector) as HTMLElement & { checked: boolean };
  el.checked = checked;
  el.dispatchEvent(new CustomEvent('kernChange', { detail: { checked } }));
}

/** Clicks a kern-button (or any element). */
export function clickKern(root: ParentNode, selector: string): void {
  find(root, selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** Current `value` property of a Kern field. */
export function kernValueOf(root: ParentNode, selector: string): string | undefined {
  return (find(root, selector) as HTMLElement & { value?: string }).value;
}

/** Sets a named field of any kind: Kern fields via their events, native inputs/selects via input/change. */
export function fill(root: ParentNode, name: string, value: string): void {
  const el = root.querySelector<HTMLElement & { value: string }>(`[name="${name}"]`);
  if (!el) throw new Error(`no field ${name}`);
  if (el.localName.startsWith('kern-')) {
    setKernValue(root, `[name="${name}"]`, value);
    return;
  }
  el.value = value;
  el.dispatchEvent(new Event(el.localName === 'select' ? 'change' : 'input'));
}

/** Flips a named kern-checkbox / kern-switch. */
export function toggleNamed(root: ParentNode, name: string): void {
  const el = root.querySelector<HTMLElement & { checked?: boolean }>(`[name="${name}"]`);
  if (!el) throw new Error(`no field ${name}`);
  setKernChecked(root, `[name="${name}"]`, !el.checked);
}
