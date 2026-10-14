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
    path: 'protokoll',
    title: 'Protokoll · Shelly Manager',
    data: { title: 'Protokoll' },
    loadComponent: () => import('./features/placeholder/placeholder-page').then((m) => m.PlaceholderPage),
  },
  { path: '**', redirectTo: 'inventar' },
];
