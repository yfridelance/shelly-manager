import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'scan' },
  { path: 'scan', title: 'Scan · Shelly Manager', loadComponent: () => import('./features/scan/scan-page').then((m) => m.ScanPage) },
  {
    path: 'inventar',
    title: 'Inventar · Shelly Manager',
    data: { title: 'Inventar' },
    loadComponent: () => import('./features/placeholder/placeholder-page').then((m) => m.PlaceholderPage),
  },
  {
    path: 'protokoll',
    title: 'Protokoll · Shelly Manager',
    data: { title: 'Protokoll' },
    loadComponent: () => import('./features/placeholder/placeholder-page').then((m) => m.PlaceholderPage),
  },
  { path: '**', redirectTo: 'scan' },
];
