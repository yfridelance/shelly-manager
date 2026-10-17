import { Routes } from '@angular/router';

// Titles are translation keys (core/i18n/title-strategy.ts).

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inventar' },
  { path: 'scan', title: 'nav.scan', loadComponent: () => import('./features/scan/scan-page').then((m) => m.ScanPage) },
  {
    path: 'inventar',
    title: 'nav.inventory',
    loadComponent: () => import('./features/inventory/inventory-page').then((m) => m.InventoryPage),
  },
  {
    path: 'inventar/:mac',
    title: 'titles.device',
    loadComponent: () => import('./features/device/device-page').then((m) => m.DevicePage),
  },
  {
    path: 'templates',
    title: 'nav.templates',
    loadComponent: () => import('./features/templates/templates-page').then((m) => m.TemplatesPage),
  },
  {
    path: 'templates/neu',
    title: 'titles.newTemplate',
    loadComponent: () => import('./features/templates/template-editor').then((m) => m.TemplateEditor),
  },
  {
    path: 'templates/:id',
    title: 'titles.template',
    loadComponent: () => import('./features/templates/template-editor').then((m) => m.TemplateEditor),
  },
  {
    path: 'templates/:id/anwenden',
    title: 'titles.applyTemplate',
    loadComponent: () => import('./features/templates/template-apply').then((m) => m.TemplateApply),
  },
  {
    path: 'standorte',
    title: 'nav.sites',
    loadComponent: () => import('./features/sites/sites-page').then((m) => m.SitesPage),
  },
  {
    path: 'protokoll',
    title: 'nav.log',
    loadComponent: () => import('./features/log/log-page').then((m) => m.LogPage),
  },
  { path: '**', redirectTo: 'inventar' },
];
