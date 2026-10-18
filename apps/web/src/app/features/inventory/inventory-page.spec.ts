import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { Device } from '../../core/api.types';
import { InventoryPage } from './inventory-page';
import { InventoryFilters } from './inventory-filters';

const device = (over: Partial<Device>): Device => ({
  mac: '000000000000', ip: null, gen: 2, model: null, app: null, firmware: null, name: null, deviceName: null, deviceId: null, siteId: 1,
  authRequired: false, floor: null, location: null, notes: null, kind: null, functions: null, state: 'active',
  firstSeen: '2026-10-14T10:00:00.000Z', lastSeen: '2026-10-14T10:00:00.000Z', lastSnapshotAt: null,
  updateStable: null, updateBeta: null, updateCheckedAt: null, ...over,
});

const DEVICES: Device[] = [
  device({ mac: 'A8032AB12345', name: 'Boiler', gen: 2, ip: '10.0.0.20', location: 'Keller', notes: 'Sicherung F3', deviceId: 'shellyplus1pm-a8032ab12345',
    kind: 'Boiler', functions: { switch: 1, cover: 0, light: 0, meter: 0, input: 1, sensor: 0, metering: true } }),
  device({
    mac: 'E868E7A1B2C3', name: 'Licht Garten', gen: 1, ip: '10.0.0.3', firmware: '20230913-112003/v1.14.0-gcb84623',
    updateStable: '20240819-074343/v1.14.1-gcb84623',
  }),
  device({ mac: '7C2C67B2B2B2', name: null, gen: 4, ip: '10.0.0.100', state: 'reset' }),
];

describe('InventoryPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/devices?site=1').flush(DEVICES);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent?.trim());
    return { fixture, el, names };
  }

  it('lists devices sorted by name, unnamed last, with short firmware and formatted MAC', async () => {
    const { el, names } = await render();
    expect(names()).toEqual(['Boiler', 'Licht Garten', '(ohne Namen)']);
    expect(el.textContent).toContain('v1.14.0');
    expect(el.textContent).toContain('E8:68:E7:A1:B2:C3');
    expect(el.textContent).toContain('Zurückgesetzt');
  });

  it('searches notes, filters by generation and sorts IPs numerically', async () => {
    const { fixture, el, names } = await render();
    const filters = TestBed.inject(InventoryFilters);

    filters.search.set('f3');
    await fixture.whenStable();
    expect(names()).toEqual(['Boiler']);
    expect(el.textContent).toContain('1 von 3 Geräten');

    filters.reset();
    filters.gen.set(1);
    await fixture.whenStable();
    expect(names()).toEqual(['Licht Garten']);

    filters.reset();
    filters.sortBy('ip');
    await fixture.whenStable();
    expect(names()).toEqual(['Licht Garten', 'Boiler', '(ohne Namen)']);
    filters.sortBy('ip');
    await fixture.whenStable();
    expect(names()).toEqual(['(ohne Namen)', 'Boiler', 'Licht Garten']);
    filters.sortBy('name');
  });

  it('shows type and function and filters by function', async () => {
    const { fixture, el, names } = await render();
    const kindCell = [...el.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('Boiler'))?.querySelector('td.kind');
    expect([...(kindCell?.querySelectorAll('span') ?? [])].map((sp) => sp.textContent?.trim())).toEqual(['Boiler', 'Schalter · Messung']);
    const filters = TestBed.inject(InventoryFilters);
    filters.function.set('metering');
    await fixture.whenStable();
    expect(names()).toEqual(['Boiler']);
    filters.function.set('unknown');
    await fixture.whenStable();
    expect(names()).toEqual(['Licht Garten', '(ohne Namen)']);
    filters.reset();
    filters.search.set('messung');
    await fixture.whenStable();
    expect(names()).toEqual(['Boiler']);
    filters.reset();
  });

  it('shows the device id and finds devices by it', async () => {
    const { fixture, el, names } = await render();
    expect([...el.querySelectorAll('thead th')].map((th) => th.textContent?.trim().replace(/[▲▼]/g, '').trim()).slice(0, 2)).toEqual(['Name', 'Geräte-ID']);
    expect(el.querySelector('tbody tr td:nth-child(2)')?.textContent?.trim()).toBe('shellyplus1pm-a8032ab12345');
    const filters = TestBed.inject(InventoryFilters);
    filters.search.set('plus1pm');
    await fixture.whenStable();
    expect(names()).toEqual(['Boiler']);
    filters.reset();
  });

  it('shows floor and location together, sorts them in building order and filters by floor', async () => {
    const fixture = TestBed.createComponent(InventoryPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/devices?site=1').flush([
      device({ mac: '1', name: 'Dach', floor: 'DG', location: 'Estrich' }),
      device({ mac: '2', name: 'Küche', floor: 'EG', location: 'Küche' }),
      device({ mac: '3', name: 'Bad', floor: '1. OG', location: 'Bad' }),
      device({ mac: '4', name: 'Waschen', floor: 'UG', location: 'Waschküche' }),
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent?.trim());
    expect(el.textContent).toContain('EG · Küche');
    const filters = TestBed.inject(InventoryFilters);
    filters.sortBy('location');
    await fixture.whenStable();
    expect(names()).toEqual(['Waschen', 'Küche', 'Bad', 'Dach']);
    filters.floor.set('1. OG');
    await fixture.whenStable();
    expect(names()).toEqual(['Bad']);
    filters.reset();
    filters.sortBy('name');
    filters.search.set('dg');
    await fixture.whenStable();
    expect(names()).toEqual(['Dach']);
    filters.reset();
  });

  it('filters devices without location', async () => {
    const { fixture, names } = await render();
    const filters = TestBed.inject(InventoryFilters);
    filters.location.set('');
    await fixture.whenStable();
    expect(names()).toEqual(['Licht Garten', '(ohne Namen)']);
    filters.reset();
  });

  it('marks and filters devices with a firmware update', async () => {
    const { fixture, el, names } = await render();
    expect(el.querySelector('tbody tr:nth-child(2) kern-badge')?.getAttribute('title')).toBe('Update auf v1.14.1 verfügbar');
    expect(el.textContent).toContain('nur mit Firmware-Update (1)');
    TestBed.inject(InventoryFilters).onlyUpdates.set(true);
    await fixture.whenStable();
    expect(names()).toEqual(['Licht Garten']);
    TestBed.inject(InventoryFilters).reset();
  });
});
