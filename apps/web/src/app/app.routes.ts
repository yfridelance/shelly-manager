import { Routes } from '@angular/router';
import * as kern from './core/kern-lazy';

// Titles are translation keys (core/i18n/title-strategy.ts).

/** Loads a page together with the Kern elements only it needs (core/kern-lazy.ts). */
function page<T>(load: () => Promise<T>, elements: () => Promise<unknown>): () => Promise<T> {
  return () => Promise.all([load(), elements()]).then(([component]) => component);
}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inventar' },
  { path: 'scan', title: 'nav.scan', loadComponent: page(() => import('./features/scan/scan-page').then((m) => m.ScanPage), kern.ipInput) },
  {
    path: 'inventar',
    title: 'nav.inventory',
    loadComponent: () => import('./features/inventory/inventory-page').then((m) => m.InventoryPage),
  },
  {
    path: 'inventar/:mac',
    title: 'titles.device',
    loadComponent: page(() => import('./features/device/device-page').then((m) => m.DevicePage), kern.deviceElements),
  },
  {
    path: 'templates',
    title: 'nav.templates',
    loadComponent: () => import('./features/templates/templates-page').then((m) => m.TemplatesPage),
  },
  {
    path: 'templates/neu',
    title: 'titles.newTemplate',
    loadComponent: page(() => import('./features/templates/template-editor').then((m) => m.TemplateEditor), kern.templateEditorElements),
  },
  {
    path: 'templates/:id',
    title: 'titles.template',
    loadComponent: page(() => import('./features/templates/template-editor').then((m) => m.TemplateEditor), kern.templateEditorElements),
  },
  {
    path: 'templates/:id/anwenden',
    title: 'titles.applyTemplate',
    loadComponent: page(() => import('./features/templates/template-apply').then((m) => m.TemplateApply), kern.templateApplyElements),
  },
  {
    path: 'standorte',
    title: 'nav.sites',
    loadComponent: () => import('./features/sites/sites-page').then((m) => m.SitesPage),
  },
  {
    path: 'protokoll',
    title: 'nav.log',
    loadComponent: page(() => import('./features/log/log-page').then((m) => m.LogPage), kern.pagination),
  },
  { path: '**', redirectTo: 'inventar' },
];
