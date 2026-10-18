// Test helpers: Kern elements are not upgraded in jsdom, so tests set the property and fire the Kern event.

function find(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`${selector} missing`);
  return el;
}

/** Types into a kern-input / kern-textarea (`kernInput`) or picks in a kern-select / kern-segmented (`kernChange`). */
export function setKernValue(root: ParentNode, selector: string, value: string): void {
  const el = find(root, selector) as HTMLElement & { value: string };
  el.value = value;
  const event = el.localName === 'kern-input' || el.localName === 'kern-textarea' ? 'kernInput' : 'kernChange';
  el.dispatchEvent(new CustomEvent(event, { detail: { value } }));
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
