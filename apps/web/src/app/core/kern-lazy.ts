// Kern elements that only some pages use: loaded with the page's route (its lazy chunk) instead of at start, so the
// initial bundle only carries what the shell and most pages need (core/kern.ts). Tests import the components
// directly and never register Kern elements, so they are unaffected.

type DefineModule = { defineCustomElement: () => void };

function define(...modules: Promise<DefineModule>[]): Promise<void> {
  return Promise.all(modules).then((list) => list.forEach((m) => m.defineCustomElement()));
}

export const breadcrumb = () => define(import('@yfridelance/kern/components/kern-breadcrumb.js'));

export const deviceElements = () =>
  Promise.all([
    breadcrumb(),
    define(
      import('@yfridelance/kern/components/kern-copy.js'),
      import('@yfridelance/kern/components/kern-json.js'),
      import('@yfridelance/kern/components/kern-json-diff.js'),
      import('@yfridelance/kern/components/kern-kv.js'),
      import('@yfridelance/kern/components/kern-kv-item.js'),
      import('@yfridelance/kern/components/kern-tab-panel.js'),
      import('@yfridelance/kern/components/kern-tabs.js'),
    ),
  ]);

export const ipInput = () => define(import('@yfridelance/kern/components/kern-ip-input.js'));

export const templateEditorElements = () =>
  Promise.all([
    breadcrumb(),
    ipInput(),
    define(import('@yfridelance/kern/components/kern-segmented.js'), import('@yfridelance/kern/components/kern-step-input.js')),
  ]);

export const templateApplyElements = () =>
  Promise.all([
    breadcrumb(),
    ipInput(),
    define(import('@yfridelance/kern/components/kern-list.js'), import('@yfridelance/kern/components/kern-list-item.js')),
  ]);

export const pagination = () => define(import('@yfridelance/kern/components/kern-pagination.js'));
