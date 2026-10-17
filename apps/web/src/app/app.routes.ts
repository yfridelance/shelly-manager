import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inventar' },
  { path: 'scan', title: 'Scan · Shelly Manager', loadComponent: () => import('./features/scan/scan-page').then((m) => m.ScanPage) },
  {
    path: 'inventar',
    title: 'Inventar · Shelly Manager',
    loadComponent: () => import('./features/inventory/inventory-page').then((m) => m.InventoryPage),
  },
  {
    path: 'inventar/:mac',
    title: 'Gerät · Shelly Manager',
    loadComponent: () => import('./features/device/device-page').then((m) => m.DevicePage),
  },
  {
    path: 'templates',
    title: 'Templates · Shelly Manager',
    loadComponent: () => import('./features/templates/templates-page').then((m) => m.TemplatesPage),
  },
  {
    path: 'templates/neu',
    title: 'Neues Template · Shelly Manager',
    loadComponent: () => import('./features/templates/template-editor').then((m) => m.TemplateEditor),
  },
  {
    path: 'templates/:id',
    title: 'Template · Shelly Manager',
    loadComponent: () => import('./features/templates/template-editor').then((m) => m.TemplateEditor),
  },
  {
    path: 'templates/:id/anwenden',
    title: 'Template anwenden · Shelly Manager',
    loadComponent: () => import('./features/templates/template-apply').then((m) => m.TemplateApply),
  },
  {
    path: 'standorte',
    title: 'Standorte · Shelly Manager',
    loadComponent: () => import('./features/sites/sites-page').then((m) => m.SitesPage),
  },
  {
    path: 'protokoll',
    title: 'Protokoll · Shelly Manager',
    loadComponent: () => import('./features/log/log-page').then((m) => m.LogPage),
  },
  { path: '**', redirectTo: 'inventar' },
];
