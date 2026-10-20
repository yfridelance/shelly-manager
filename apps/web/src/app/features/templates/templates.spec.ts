import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { Device, Template, TemplatePreview } from '../../core/api.types';
import { itemText } from '../../core/template-fields';
import { TemplateApply } from './template-apply';
import { TemplateEditor } from './template-editor';
import { FeedbackStub, provideFeedbackStub } from '../../../testing/feedback';
import { Feedback } from '../../core/feedback';

const tick = () => new Promise((r) => setTimeout(r));

const TEMPLATE: Template = {
  id: 7, siteId: 1, name: 'Haus-Standard', description: null, createdAt: '2026-10-15T08:00:00.000Z', updatedAt: '2026-10-15T08:00:00.000Z',
  settings: { mqtt: { enable: true, server: 'mqtt.home:1883' }, cloud: { enable: false } },
};

const device = (over: Partial<Device>): Device => ({
  mac: '000000000000', ip: '10.0.0.1', gen: 2, model: null, app: null, firmware: null, name: null, deviceName: null, deviceId: null, siteId: 1,
  authRequired: false, floor: null, location: null, notes: null, kind: null, functions: null, state: 'active', firstSeen: '2026-10-14T10:00:00.000Z',
  lastSeen: '2026-10-14T10:00:00.000Z', lastSnapshotAt: null, updateStable: null, updateBeta: null, updateCheckedAt: null, ...over,
});

import { fill, kernValueOf, setKernValue, toggleNamed } from '../../../testing/kern';
describe('itemText', () => {
  it('describes plan items in German', () => {
    expect(itemText({ key: 'mqtt.server', status: 'change', current: null, target: 'mqtt.home:1883' })).toBe('MQTT: Server: – → mqtt.home:1883');
    expect(itemText({ key: 'cloud.enable', status: 'same', current: false, target: false })).toBe('Shelly Cloud: Cloud-Verbindung: bereits Aus');
    expect(itemText({ key: 'coiot.enable', status: 'unsupported', target: false, reason: 'generation' })).toBe('CoIoT: CoIoT an: für diese Generation nicht verfügbar');
    expect(itemText({ key: 'wifiAp.enable', status: 'unsupported', current: false, target: true, reason: 'password' })).toBe(
      'WLAN-Access-Point des Geräts: Access-Point an: AP-Passwort nötig, wird nicht eingeschaltet',
    );
    expect(itemText({ key: 'network.sta.mode', status: 'change', current: 'dhcp', target: 'static' })).toBe('Haupt-WLAN: Adressvergabe: DHCP → statisch');
    expect(itemText({ key: 'network.sta1.mode', status: 'unsupported', target: 'static', reason: 'inactive' })).toBe(
      'Zweites WLAN: Adressvergabe: auf dem Gerät nicht eingerichtet',
    );
    expect(itemText({ key: 'network.sta.mode', status: 'unsupported', target: 'static', reason: 'no_ip' })).toBe(
      'Haupt-WLAN: Adressvergabe: keine freie IP im Bereich',
    );
    expect(itemText({ key: 'script', status: 'change', current: null, target: { name: 'heizung', enable: true, start: true } })).toBe(
      'Script: anlegen «heizung», Autostart an, starten',
    );
  });
});

describe('TemplateEditor', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TemplateEditor],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideFeedbackStub()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  function type(el: HTMLElement, name: string, value: string): void {
    fill(el, name, value);
  }

  it('builds settings only from included fields; typing includes a field', async () => {
    const fixture = TestBed.createComponent(TemplateEditor);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();

    type(el, 'name', 'Haus-Standard');
    type(el, 'mqtt.server', 'mqtt.home:1883');
    type(el, 'cloud.enable', 'false');
    type(el, 'time.lat', '47.37');
    // Included, then excluded again: must not end up in the template.
    type(el, 'mqtt.user', 'shelly');
    await fixture.whenStable();
    toggleNamed(el, 'on:mqtt.user');
    await fixture.whenStable();
    expect(el.querySelector<HTMLElement & { checked?: boolean }>('[name="on:mqtt.server"]')?.checked).toBe(true);

    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    const req = http.expectOne({ method: 'POST', url: '/api/templates' });
    expect(req.request.body).toEqual({
      siteId: 1,
      name: 'Haus-Standard',
      description: null,
      settings: { mqtt: { server: 'mqtt.home:1883' }, cloud: { enable: false }, time: { lat: 47.37 } },
    });
  });

  it('includes a script only with name and code', async () => {
    const fixture = TestBed.createComponent(TemplateEditor);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    type(el, 'name', 'Scripts');
    toggleNamed(el, 'on:script');
    await fixture.whenStable();
    const save = () => [...el.querySelectorAll<HTMLElement & { disabled?: boolean }>('kern-button, button')].find((b) => b.textContent?.includes('Speichern'));
    type(el, 'script.name', 'heizung');
    await fixture.whenStable();
    expect(save()?.disabled).toBe(true);
    type(el, 'script.code', 'print(1);');
    await fixture.whenStable();
    expect(save()?.disabled).toBe(false);
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    expect(http.expectOne({ method: 'POST', url: '/api/templates' }).request.body).toMatchObject({
      settings: { script: { name: 'heizung', code: 'print(1);', enable: true, start: true } },
    });
  });
});

describe('TemplateApply', () => {
  let http: HttpTestingController;
  const DEVICES = [
    device({ mac: 'A8032AB12345', name: 'Boiler', ip: '10.0.0.3' }),
    device({ mac: '7C2C67B2B2B2', name: 'Garage', ip: '10.0.0.6', gen: 4, authRequired: true }),
    device({ mac: 'E868E7A1B2C3', name: 'Licht', ip: '10.0.0.1', gen: 1 }),
    device({ mac: '111111111111', name: 'Weg', state: 'reset' }),
    device({ mac: '222222222222', name: 'Mini', ip: '10.0.0.5', gen: 3 }),
  ];
  const PREVIEWS: TemplatePreview[] = [
    { mac: 'A8032AB12345', name: 'Boiler', gen: 2, state: 'active', assignedIps: {}, basedOn: '2026-10-15T08:00:00.000Z', items: [
      { key: 'mqtt.enable', status: 'change', current: false, target: true },
      { key: 'cloud.enable', status: 'same', current: false, target: false },
    ] },
    { mac: '7C2C67B2B2B2', name: 'Garage', gen: 4, state: 'active', assignedIps: {}, basedOn: null, items: [] },
    { mac: 'E868E7A1B2C3', name: 'Licht', gen: 1, state: 'active', assignedIps: {}, basedOn: '2026-10-15T08:00:00.000Z', items: [
      { key: 'mqtt.enable', status: 'same', current: true, target: true },
      { key: 'cloud.enable', status: 'same', current: false, target: false },
    ] },
    // Only unsupported settings: nothing to change, must not be selected by "nur mit Änderungen".
    { mac: '222222222222', name: 'Mini', gen: 3, state: 'active', assignedIps: {}, basedOn: '2026-10-15T08:00:00.000Z', items: [
      { key: 'coiot.enable', status: 'unsupported', target: false, reason: 'generation' },
    ] },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TemplateApply],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideFeedbackStub()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(TemplateApply);
    fixture.componentRef.setInput('id', '7');
    fixture.detectChanges();
    http.expectOne('/api/templates/7').flush(TEMPLATE);
    await tick();
    TestBed.tick(); // the device list depends on the template's site
    http.expectOne('/api/devices?site=1').flush(DEVICES);
    await tick();
    TestBed.tick(); // runs the effect that loads the preview
    await tick();
    http.expectOne({ method: 'POST', url: '/api/templates/7/preview' }).flush(PREVIEWS);
    await tick();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll<HTMLElement & { disabled?: boolean }>('kern-button, button')].find((b) => b.textContent?.includes(text));
    return { fixture, el, button };
  }

  it('previews per device and applies to the chosen ones after one confirmation', async () => {
    const { fixture, el, button } = await render();
    const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => r.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(rows()).toHaveLength(4); // the reset device is not offered
    expect(rows()[0]).toContain('1 Änderung');
    expect(rows()[1]).toContain('kein Snapshot');
    expect(rows()[2]).toContain('keine Änderung');
    expect(rows()[3]).toContain('1 nicht unterstützt');

    button('nur mit Änderungen')?.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('2 ausgewählt');

    fill(el, 'password', 'gen4-secret');
    fill(el, 'mqttPassword', 'mqtt-geheim');
    await fixture.whenStable();

    const feedback = TestBed.inject(Feedback) as FeedbackStub;
    feedback.answer = false;
    button('Auf 2 Geräte anwenden')?.click();
    await tick();
    http.expectNone({ method: 'POST', url: (u: string) => u.includes('apply-template') } as never);
    expect(feedback.questions.at(-1)).toMatchObject({ heading: 'Template «Haus-Standard» auf 2 Geräte anwenden?', confirmLabel: 'Ja, anwenden' });
    feedback.answer = true;
    button('Auf 2 Geräte anwenden')?.click();
    await tick();

    const boiler = http.expectOne('/api/devices/A8032AB12345/apply-template');
    const garage = http.expectOne('/api/devices/7C2C67B2B2B2/apply-template');
    expect(boiler.request.body).toEqual({ templateId: 7, rebootIfRequired: true, secrets: { mqttPassword: 'mqtt-geheim' } });
    expect(garage.request.body).toEqual({
      templateId: 7, rebootIfRequired: true, secrets: { mqttPassword: 'mqtt-geheim' }, credentials: { password: 'gen4-secret' },
    });
    expect(kernValueOf(el, '[name="password"]')).toBe('');

    boiler.flush({ snapshotId: 1, items: [], changed: 2, restartRequired: true, rebooted: true });
    garage.flush({ error: 'snapshot_failed', message: 'x', cause: 'auth_invalid' }, { status: 409, statusText: 'Conflict' });
    await tick();
    http.expectOne({ method: 'POST', url: '/api/templates/7/preview' }).flush(PREVIEWS);
    await tick();
    await fixture.whenStable();

    expect(rows()[0]).toContain('✓ 2 Einstellungen geändert, neu gestartet');
    expect(rows()[1]).toContain('✗ Snapshot vorher fehlgeschlagen, nichts geändert: Zugangsdaten falsch');
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('1 von 2 erfolgreich · 1 mit Fehler');
  });
});

describe('network templates in the UI', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TemplateEditor, TemplateApply],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideFeedbackStub()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('editor: static network needs IP range and netmask; typing includes the WLAN', async () => {
    const fixture = TestBed.createComponent(TemplateEditor);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    const set = (name: string, value: string) => fill(el, name, value);
    set('name', 'Fix-IP');
    set('network.sta.mode', 'static');
    await fixture.whenStable();
    const save = () => [...el.querySelectorAll<HTMLElement & { disabled?: boolean }>('kern-button, button')].find((b) => b.textContent?.includes('Speichern'));
    expect(save()?.disabled).toBe(true);
    set('network.sta.ipFrom', '192.168.10.50');
    set('network.sta.netmask', '255.255.255.0');
    set('network.sta.gateway', '192.168.10.1');
    await fixture.whenStable();
    expect(save()?.disabled).toBe(false);
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    expect(http.expectOne({ method: 'POST', url: '/api/templates' }).request.body).toEqual({
      siteId: 1,
      name: 'Fix-IP',
      description: null,
      settings: { network: { sta: { mode: 'static', ipFrom: '192.168.10.50', netmask: '255.255.255.0', gateway: '192.168.10.1' } } },
    });
  });

  it('apply: shows planned IPs, lets you edit them and sends them per device', async () => {
    const template: Template = {
      ...TEMPLATE,
      settings: { network: { sta: { mode: 'static', ipFrom: '192.168.10.50', netmask: '255.255.255.0' } } },
    };
    const devices = [device({ mac: 'A8032AB12345', name: 'Boiler', ip: '10.0.0.3' }), device({ mac: 'E868E7A1B2C3', name: 'Licht', ip: '10.0.0.1', gen: 1 })];
    const preview = (ips: Record<string, string>): TemplatePreview[] =>
      devices.map((d) => ({
        mac: d.mac, name: d.name, gen: d.gen, state: 'active', basedOn: '2026-10-17T08:00:00.000Z', assignedIps: { sta: ips[d.mac] },
        items: [{ key: 'network.sta.mode', status: 'change', current: 'dhcp', target: 'static' }],
      }));
    const fixture = TestBed.createComponent(TemplateApply);
    fixture.componentRef.setInput('id', '7');
    fixture.detectChanges();
    http.expectOne('/api/templates/7').flush(template);
    await tick();
    TestBed.tick();
    http.expectOne('/api/devices?site=1').flush(devices);
    await tick();
    TestBed.tick();
    await tick();
    http.expectOne({ method: 'POST', url: '/api/templates/7/preview' }).flush(preview({ A8032AB12345: '192.168.10.51', E868E7A1B2C3: '192.168.10.52' }));
    await tick();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('thead th')].map((t) => t.textContent?.trim())).toContain('Neue IP');
    expect(el.textContent).toContain('Dieses Template ändert Netzwerkeinstellungen');

    [...el.querySelectorAll<HTMLElement & { disabled?: boolean }>('kern-button, button')].find((b) => b.textContent?.includes('alle sichtbaren'))?.click();
    await tick();
    TestBed.tick();
    // Selection changed: the IPs are planned again for exactly these devices.
    await new Promise((r) => setTimeout(r, 350));
    const replan = http.expectOne({ method: 'POST', url: '/api/templates/7/preview' });
    expect(replan.request.body).toEqual({ macs: ['A8032AB12345', 'E868E7A1B2C3'] });
    replan.flush(preview({ A8032AB12345: '192.168.10.50', E868E7A1B2C3: '192.168.10.51' }));
    await tick();
    await fixture.whenStable();

    expect(kernValueOf(el, '[name="ip:A8032AB12345:sta"]')).toBe('192.168.10.50');
    setKernValue(el, '[name="ip:E868E7A1B2C3:sta"]', '192.168.10.80');
    el.querySelector('[name="ip:E868E7A1B2C3:sta"]')?.dispatchEvent(new CustomEvent('kernChange', { detail: { value: '192.168.10.80' } }));
    await fixture.whenStable();
    expect([...el.querySelectorAll<HTMLElement & { disabled?: boolean }>('kern-button, button')].some((b) => b.textContent?.includes('Export für DHCP-Reservierung'))).toBe(true);

    [...el.querySelectorAll<HTMLElement & { disabled?: boolean }>('kern-button, button')].find((b) => b.textContent?.includes('Auf 2 Geräte anwenden'))?.click();
    await tick();
    // Network templates repeat the warning in the confirmation.
    expect((TestBed.inject(Feedback) as FeedbackStub).questions.at(-1)?.message).toContain('IP');
    const boiler = http.expectOne('/api/devices/A8032AB12345/apply-template');
    const licht = http.expectOne('/api/devices/E868E7A1B2C3/apply-template');
    expect(boiler.request.body).toMatchObject({ network: { sta: '192.168.10.50' } });
    expect(licht.request.body).toMatchObject({ network: { sta: '192.168.10.80' } });
    boiler.flush({ snapshotId: 1, items: [], changed: 5, restartRequired: false, rebooted: false, network: { ip: '192.168.10.50', confirmed: true } });
    licht.flush({ snapshotId: 2, items: [], changed: 4, restartRequired: false, rebooted: false, network: { ip: '192.168.10.80', confirmed: false } });
    await tick();
    for (const req of http.match(() => true)) req.flush([]);
    await tick();
    await fixture.whenStable();
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(rows[0]).toContain('✓ 5 Einstellungen geändert, jetzt unter 192.168.10.50');
    expect(rows[1]).toContain('✗ 4 Einstellungen geändert, unter 192.168.10.80 nicht erreichbar – bitte neu scannen');
  });
});
