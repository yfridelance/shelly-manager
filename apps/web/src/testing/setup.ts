// Vitest setup: Kern elements are not upgraded in jsdom. Emulate the parts of kern-button that tests rely on,
// so clicking it behaves like the real element (disabled swallows the click, submit/reset act on the form).
document.addEventListener(
  'click',
  (event) => {
    const button = (event.target as Element | null)?.closest?.('kern-button') as (HTMLElement & { disabled?: boolean; busy?: boolean; type?: string }) | null;
    if (!button) return;
    if (button.disabled || button.busy) {
      event.stopImmediatePropagation();
      event.preventDefault();
      return;
    }
    const type = button.type ?? button.getAttribute('type');
    const form = button.closest('form');
    if (form && type === 'submit') form.dispatchEvent(new Event('submit', { cancelable: true }));
    if (form && type === 'reset') form.reset();
  },
  true,
);
