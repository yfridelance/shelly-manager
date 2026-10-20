import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { Device } from '../../core/api.types';
import { InventoryPage } from './inventory-page';
import { InventoryFilters } from './inventory-filters';

const device = (over: Partial<Device>): Device => ({
  mac: '000000000000', ip: '10.0.0.1', gen: 2, model: null, app: null, firmware: '20241011-114455/1.4.4-g6d2a586',
  name: null, deviceName: null, deviceId: null, siteId: 1, authRequired: false, floor: null, location: null, notes: null, kind: null, functions: null, state: 'active',
  firstSeen: '2026-10-14T10:00:00.000Z', lastSeen: '2026-10-14T10:00:00.000Z', lastSnapshotAt: null,
  updateStable: null, updateBeta: null, updateCheckedAt: null, ...over,
});

const DEVICES: Device[] = [
  device({ mac: 'A8032AB12345', name: 'Boiler', ip: '10.0.0.3' }),
  device({ mac: 'A8032AB67890', name: 'Rollladen', ip: '10.0.0.4', authRequired: true }),
  device({ mac: 'E868E7D4E5F6', name: 'Storen', ip: '10.0.0.2', gen: 1, authRequired: true }),
  device({ mac: '34CDB0A1A1A1', name: 'Mini', ip: '10.0.0.5' }),
  device({ mac: '7C2C67B2B2B2', name: 'Weg', ip: '10.0.0.6', state: 'reset' }),
  device({ mac: '111111111111', name: 'Ohne IP', ip: null }),
];

import { setKernValue } from '../../../testing/kern';
describe('Inventory: check all devices for firmware updates', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => TestBed.inject(InventoryFilters).reset());

  async function render() {
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();
    http.expectOne('/api/devices?site=1').flush(DEVICES);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll<HTMLElement>('kern-button')].find((b) => b.textContent?.includes(text));
    // jsdom does not upgrade kern-button, so a submit button cannot submit its form: send the submit directly.
    const submit = () => el.querySelector('kern-card.panel form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    const panel = () => el.querySelector<HTMLElement>('kern-card.panel');
    return { fixture, el, button, panel, submit };
  }

  const tick = () => new Promise((r) => setTimeout(r));

  it('checks only reachable devices, skips protected ones without password and summarizes', async () => {
    const { fixture, el, button, panel, submit } = await render();
    button('Alle auf Updates prüfen')?.click();
    await fixture.whenStable();
    expect(panel()?.textContent).toContain('4 aktive Geräte');
    expect(panel()?.textContent).toContain('2 davon sind passwortgeschützt');

    submit();
    await tick();
    const requests = http.match((r) => r.method === 'POST');
    // Reset device and device without IP are not asked; protected ones are skipped without password.
    expect(requests.map((r) => r.request.url).sort()).toEqual([
      '/api/devices/34CDB0A1A1A1/firmware/check',
      '/api/devices/A8032AB12345/firmware/check',
    ]);
    expect(requests.every((r) => !('credentials' in (r.request.body as object)))).toBe(true);
    for (const r of requests) {
      r.flush(
        r.request.url.includes('A8032AB12345')
          ? { stable: '1.5.0', beta: null, checkedAt: '2026-10-15T08:00:00.000Z' }
          : { stable: null, beta: '1.6.0-beta1', checkedAt: '2026-10-15T08:00:00.000Z' },
      );
    }
    await tick();
    await fixture.whenStable();

    expect(panel()?.querySelector<HTMLElement & { label?: string }>('kern-progress')?.label).toBe('4 von 4 geprüft');
    expect(panel()?.textContent?.replace(/\s+/g, ' ')).toContain('1 mit Update, 1 aktuell · 1 mit Beta · 2 übersprungen');
    expect(panel()?.querySelectorAll('.problems li')).toHaveLength(2);
    // The row got its badge without reloading the list.
    const boilerRow = [...el.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('Boiler'));
    expect((boilerRow?.querySelector('kern-badge')?.closest('kern-tooltip') as (Element & { text?: string }) | null)?.text).toBe('Update auf 1.5.0 verfügbar');

    button('Nur Geräte mit Update anzeigen')?.click();
    await fixture.whenStable();
    expect([...el.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent?.trim())).toEqual(['Boiler']);
  });

  it('uses the password for protected devices only and clears it', async () => {
    const { fixture, el, button, submit } = await render();
    button('Alle auf Updates prüfen')?.click();
    await fixture.whenStable();
    setKernValue(el, 'kern-card.panel kern-input[name="password"]', 'geheim');
    await fixture.whenStable();
    submit();
    await tick();

    const requests = http.match((r) => r.method === 'POST');
    expect(requests).toHaveLength(4);
    const bodies = Object.fromEntries(requests.map((r) => [r.request.url.split('/')[3], r.request.body as Record<string, unknown>]));
    expect(bodies['A8032AB67890']).toEqual({ credentials: { password: 'geheim' } });
    expect(bodies['E868E7D4E5F6']).toEqual({ credentials: { password: 'geheim', username: 'admin' } });
    expect(bodies['A8032AB12345']).toEqual({});

    for (const r of requests) {
      if (r.request.url.includes('E868E7D4E5F6')) r.flush({ error: 'auth_invalid', message: 'x' }, { status: 502, statusText: 'Bad Gateway' });
      else r.flush({ stable: null, beta: null, checkedAt: '2026-10-15T08:00:00.000Z' });
    }
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('kern-card.panel kern-input[name="password"]')).toBeNull();
    expect(el.querySelector('kern-card.panel')?.textContent).toContain('Zugangsdaten falsch');
    expect(el.querySelector('kern-card.panel')?.textContent?.replace(/\s+/g, ' ')).toContain('0 mit Update, 3 aktuell · 1 Fehler');
  });
});
