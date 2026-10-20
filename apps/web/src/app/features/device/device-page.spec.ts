import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { DeviceDetails } from '../../core/api.types';
import { DevicePage } from './device-page';

const DETAILS: DeviceDetails = {
  device: {
    mac: 'A8032AB67890', ip: '10.0.0.4', gen: 2, model: 'SNSW-102P16EU', app: 'Plus2PM', firmware: '20241011-114455/1.4.4-g6d2a586',
    name: 'Rollladen Büro', deviceName: 'Rollladen Büro', deviceId: 'shellyplus2pm-a8032ab67890', siteId: 1, authRequired: true, floor: null, location: null, notes: null, kind: null, functions: null, state: 'active',
    firstSeen: '2026-10-14T10:00:00.000Z', lastSeen: '2026-10-14T10:00:00.000Z', lastSnapshotAt: null,
    updateStable: null, updateBeta: null, updateCheckedAt: null,
  },
  latestSnapshot: null,
  snapshots: [],
};

import { setKernChecked, setKernValue } from '../../../testing/kern';
import { FeedbackStub, provideFeedbackStub } from '../../../testing/feedback';
import { Feedback } from '../../core/feedback';

/** Lets the confirmation promise resolve before the request is expected. */
const tick = () => new Promise((r) => setTimeout(r));

describe('DevicePage', () => {
  let http: HttpTestingController;
  let feedback: FeedbackStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DevicePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideFeedbackStub()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    feedback = TestBed.inject(Feedback) as FeedbackStub;
  });

  /** Answers background loads (device list for suggestions, action history, details reload). */
  function answerBackground(details: DeviceDetails = DETAILS): void {
    for (const req of http.match((r) => r.method === 'GET')) {
      if (req.request.url.startsWith('/api/devices?') || req.request.url === '/api/sites') req.flush([]);
      else if (req.request.url.startsWith('/api/actions')) req.flush([]);
      else if (req.request.url === `/api/devices/${details.device.mac}`) req.flush(details);
    }
  }

  /** Lets promise chains run, answers what they requested, then waits for rendering. */
  async function settle(fixture: { whenStable(): Promise<unknown> }, details?: DeviceDetails): Promise<void> {
    // Two rounds: the «Ort» suggestions are requested only once the device (and its site) is known.
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r));
      TestBed.tick();
      answerBackground(details);
    }
    await fixture.whenStable();
  }

  async function render(details: DeviceDetails = DETAILS) {
    const fixture = TestBed.createComponent(DevicePage);
    fixture.componentRef.setInput('mac', details.device.mac);
    fixture.detectChanges();
    answerBackground(details);
    await settle(fixture, details);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function type(el: Element | null, value: string): void {
    const input = el as (HTMLInputElement & { localName: string }) | null;
    if (!input) throw new Error('input missing');
    input.value = value;
    // Native inputs (inline editing) fire input, Kern fields fire kernInput.
    input.dispatchEvent(input.localName.startsWith('kern-') ? new CustomEvent('kernInput', { detail: { value } }) : new Event('input'));
  }

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLElement & { disabled?: boolean }>('kern-button, button')].find((b) => b.textContent?.includes(text));

  it('saves the location inline via PATCH', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLElement>('kern-button[label="Ort bearbeiten"]')?.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('app-editable-field input');
    type(input, 'Büro OG');
    input?.form?.dispatchEvent(new Event('submit'));

    const patch = http.expectOne({ method: 'PATCH', url: '/api/devices/A8032AB67890' });
    expect(patch.request.body).toEqual({ location: 'Büro OG' });
    patch.flush({ ...DETAILS.device, location: 'Büro OG' });
    await settle(fixture);
    expect(el.textContent).toContain('Büro OG');
  });

  it('suggests a name from floor, location and kind, numbered within the site, without saving it yet', async () => {
    const details = { ...DETAILS, device: { ...DETAILS.device, floor: 'EG', location: 'Büro', kind: 'Storen' } };
    const fixture = TestBed.createComponent(DevicePage);
    fixture.componentRef.setInput('mac', details.device.mac);
    fixture.detectChanges();
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      TestBed.tick();
      for (const req of http.match((r) => r.method === 'GET')) {
        if (req.request.url.startsWith('/api/devices?')) req.flush([details.device, { ...details.device, mac: 'OTHER', name: 'EG Büro Storen' }]);
        else if (req.request.url === `/api/devices/${details.device.mac}`) req.flush(details);
        else req.flush([]);
      }
    }
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    button(el, 'Vorschlag: EG Büro Storen 2')?.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('app-editable-field input');
    expect(input?.value).toBe('EG Büro Storen 2');
    // In the editor the suggestion can be inserted again after typing.
    type(input, 'x');
    await fixture.whenStable();
    button(el, 'Vorschlag einsetzen')?.click();
    await fixture.whenStable();
    expect(input?.value).toBe('EG Büro Storen 2');
    http.expectNone({ method: 'PATCH' });
    input?.form?.dispatchEvent(new Event('submit'));
    expect(http.expectOne({ method: 'PATCH', url: '/api/devices/A8032AB67890' }).request.body).toEqual({ name: 'EG Büro Storen 2' });
  });

  it('saves the floor with building floors as suggestions', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLElement>('kern-button[label="Stockwerk bearbeiten"]')?.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('app-editable-field input');
    expect(input?.getAttribute('list')).toBe('floor-suggestions');
    expect([...el.querySelectorAll('#floor-suggestions option')].map((o) => o.getAttribute('value'))).toEqual(['UG', 'EG', 'OG', 'DG']);
    type(input, '1. OG');
    input?.form?.dispatchEvent(new Event('submit'));
    const patch = http.expectOne({ method: 'PATCH', url: '/api/devices/A8032AB67890' });
    expect(patch.request.body).toEqual({ floor: '1. OG' });
    patch.flush({ ...DETAILS.device, floor: '1. OG' });
    await settle(fixture);
  });

  it('writes a differing local name to the device only after confirmation, with the action password', async () => {
    const renamed = { ...DETAILS, device: { ...DETAILS.device, name: 'EG Büro Storen' } };
    const { fixture, el } = await render(renamed);
    expect(el.textContent).toContain('Auf dem Gerät: «Rollladen Büro»');
    expect(button(el, 'Name auf Gerät schreiben')?.disabled).toBe(true);
    type(el.querySelector('kern-input[name="password"]'), 'gen2-secret');
    await fixture.whenStable();
    feedback.answer = false;
    button(el, 'Name auf Gerät schreiben')?.click();
    await tick();
    http.expectNone({ method: 'POST' });
    expect(feedback.questions.at(-1)?.heading).toBe('«EG Büro Storen» auf das Gerät schreiben?');
    feedback.answer = true;
    button(el, 'Name auf Gerät schreiben')?.click();
    await tick();
    const post = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/name' });
    expect(post.request.body).toEqual({ name: 'EG Büro Storen', credentials: { password: 'gen2-secret' } });
    post.flush({ name: 'EG Büro Storen', snapshotId: 3 });
    const synced = { ...renamed, device: { ...renamed.device, deviceName: 'EG Büro Storen' } };
    await settle(fixture, synced);
    expect(feedback.toasts).toContain('Name «EG Büro Storen» auf das Gerät geschrieben.');
    expect(button(el, 'Name auf Gerät schreiben')).toBeUndefined();
    expect(el.textContent).toContain('Gleich wie auf dem Gerät');
  });

  it('shows the derived function and saves the type', async () => {
    const functions = { switch: 0, cover: 1, light: 0, meter: 0, input: 2, sensor: 0, metering: true };
    const { fixture, el } = await render({ ...DETAILS, device: { ...DETAILS.device, functions } });
    expect(el.textContent).toContain('Rollladen · Messung');
    el.querySelector<HTMLElement>('kern-button[label="Typ bearbeiten"]')?.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('app-editable-field input');
    expect(input?.getAttribute('list')).toBe('kind-suggestions');
    type(input, 'Storen');
    input?.form?.dispatchEvent(new Event('submit'));
    const patch = http.expectOne({ method: 'PATCH', url: '/api/devices/A8032AB67890' });
    expect(patch.request.body).toEqual({ kind: 'Storen' });
    patch.flush({ ...DETAILS.device, functions, kind: 'Storen' });
    await settle(fixture);
  });

  it('asks for the password of a protected device and clears it after sending', async () => {
    const { fixture, el } = await render();
    expect(button(el, 'Config neu einlesen')?.disabled).toBe(true);
    type(el.querySelector('kern-input[name="password"]'), 'gen2-secret');
    await fixture.whenStable();
    button(el, 'Config neu einlesen')?.click();

    const post = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/snapshot' });
    expect(post.request.body).toEqual({ credentials: { password: 'gen2-secret' } });
    post.flush({ error: 'auth_invalid', message: 'rejected' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(el.querySelector<HTMLInputElement>('kern-input[name="password"]')?.value).toBe('');
    expect(el.textContent).toContain('Snapshot fehlgeschlagen: Zugangsdaten falsch');
  });

  it('asks before rebooting', async () => {
    const open = { ...DETAILS, device: { ...DETAILS.device, authRequired: false } };
    const { fixture, el } = await render(open);
    feedback.answer = false;
    button(el, 'Neu starten')?.click();
    await tick();
    http.expectNone({ method: 'POST' });
    expect(feedback.questions.at(-1)).toMatchObject({ heading: 'Wirklich neu starten?', confirmLabel: 'Ja, neu starten', danger: true });
    feedback.answer = true;
    button(el, 'Neu starten')?.click();
    await tick();
    http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/reboot' }).flush({ ok: true });
    await settle(fixture, open);
    expect(feedback.toasts.join()).toContain('Neustart ausgelöst');
  });

  describe('factory reset dialog', () => {
    const OPEN = { ...DETAILS, device: { ...DETAILS.device, authRequired: false } };

    async function openDialog(details: DeviceDetails = OPEN) {
      const r = await render(details);
      button(r.el, 'Werkseinstellungen')?.click();
      await r.fixture.whenStable();
      const dialog = r.el.querySelector<HTMLElement>('kern-dialog');
      if (!dialog) throw new Error('dialog not open');
      return { ...r, dialog };
    }

    it('explains the consequences and needs the MAC or the name typed', async () => {
      const { fixture, dialog } = await openDialog();
      expect(dialog.textContent).toContain('AP-Modus');
      expect(dialog.textContent).toContain('aus diesem Netz verschwunden');
      expect(dialog.textContent).toContain('automatisch ein Snapshot');

      const submit = button(dialog, 'Endgültig zurücksetzen');
      expect(submit?.disabled).toBe(true);
      for (const wrong of ['A8032AB6789', 'Rollladen', 'A8032AB12345']) {
        type(dialog.querySelector('kern-input[name="confirm"]'), wrong);
        await fixture.whenStable();
        expect(submit?.disabled).toBe(true);
      }
      for (const right of ['a8:03:2a:b6:78:90', 'A8032AB67890', 'rollladen büro']) {
        type(dialog.querySelector('kern-input[name="confirm"]'), right);
        await fixture.whenStable();
        expect(submit?.disabled).toBe(false);
      }
      http.expectNone({ method: 'POST' });
    });

    it('sends exactly this MAC and reports success', async () => {
      const { fixture, el, dialog } = await openDialog();
      type(dialog.querySelector('kern-input[name="confirm"]'), 'Rollladen Büro');
      await fixture.whenStable();
      button(dialog, 'Endgültig zurücksetzen')?.click();

      const req = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' });
      expect(req.request.body).toEqual({ confirmMac: 'A8032AB67890' });
      req.flush({ snapshotId: 42, confirmed: true });
      await settle(fixture, OPEN);
      expect(el.querySelector('kern-dialog')).toBeNull();
      expect(feedback.toasts.join()).toContain('startet jetzt im AP-Modus');
      expect(feedback.toasts.join()).not.toContain('vermutlich');
    });

    it('reports an unconfirmed reset when the device dropped the connection', async () => {
      const { fixture, el, dialog } = await openDialog();
      type(dialog.querySelector('kern-input[name="confirm"]'), 'A8032AB67890');
      await fixture.whenStable();
      button(dialog, 'Endgültig zurücksetzen')?.click();
      http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' }).flush({ snapshotId: 42, confirmed: false });
      await settle(fixture, OPEN);
      expect(el.querySelector('kern-dialog')).toBeNull();
      expect(el.textContent).toContain('Reset vermutlich erfolgreich – Gerät nicht mehr erreichbar');
      expect(el.textContent).toContain('Die Config wurde vorher gesichert.');
    });

    it('offers the override only after the snapshot failed', async () => {
      const { fixture, dialog } = await openDialog();
      expect(dialog.querySelector('kern-checkbox[name="override"]')).toBeNull();
      type(dialog.querySelector('kern-input[name="confirm"]'), 'A8032AB67890');
      await fixture.whenStable();
      button(dialog, 'Endgültig zurücksetzen')?.click();
      http
        .expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' })
        .flush({ error: 'snapshot_failed', message: 'x', cause: 'timeout' }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);

      expect(dialog.textContent).toContain('Zeitüberschreitung');
      expect(dialog.textContent).toContain('nicht ausgeführt');
      const submit = button(dialog, 'Endgültig zurücksetzen');
      expect(submit?.disabled).toBe(true);
      setKernChecked(dialog, 'kern-checkbox[name="override"]', true);
      await fixture.whenStable();
      expect(submit?.disabled).toBe(false);
      submit?.click();

      const second = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' });
      expect(second.request.body).toEqual({ confirmMac: 'A8032AB67890', allowWithoutSnapshot: true });
    });

    it('sends the password of a protected device and clears it', async () => {
      const { fixture, dialog } = await openDialog(DETAILS);
      type(dialog.querySelector('kern-input[name="confirm"]'), 'A8032AB67890');
      await fixture.whenStable();
      expect(button(dialog, 'Endgültig zurücksetzen')?.disabled).toBe(true);
      type(dialog.querySelector('kern-input[name="password"]'), 'gen2-secret');
      await fixture.whenStable();
      button(dialog, 'Endgültig zurücksetzen')?.click();
      const req = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' });
      expect(req.request.body).toEqual({ confirmMac: 'A8032AB67890', credentials: { password: 'gen2-secret' } });
      req.flush({ error: 'busy', message: 'x' }, { status: 409, statusText: 'Conflict' });
      await settle(fixture, DETAILS);
      expect(dialog.querySelector<HTMLInputElement>('kern-input[name="password"]')?.value).toBe('');
    });

    it('is not offered for devices that were already reset', async () => {
      const { el } = await render({ ...OPEN, device: { ...OPEN.device, state: 'reset' } });
      expect(button(el, 'Werkseinstellungen')).toBeUndefined();
      expect(el.textContent).toContain('nicht mehr im Netz');
    });
  });

  describe('firmware', () => {
    const WITH_UPDATE: DeviceDetails = {
      ...DETAILS,
      device: { ...DETAILS.device, authRequired: false, updateStable: '1.5.0', updateBeta: null, updateCheckedAt: '2026-10-14T10:00:00.000Z' },
    };

    it('shows the available update and installs it only after confirmation', async () => {
      const { fixture, el } = await render(WITH_UPDATE);
      expect(el.textContent).toContain('Update verfügbar: 1.5.0');
      expect(button(el, 'Beta installieren')).toBeUndefined();

      feedback.answer = false;
      button(el, 'Update installieren')?.click();
      await tick();
      http.expectNone({ method: 'POST' });
      expect(feedback.questions.at(-1)?.heading).toContain('Das Gerät startet danach neu');

      feedback.answer = true;
      button(el, 'Update installieren')?.click();
      await tick();
      const req = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/firmware/update' });
      expect(req.request.body).toEqual({ channel: 'stable' });
      req.flush({ version: '1.5.0' });
      await settle(fixture, WITH_UPDATE);
      expect(feedback.toasts.join()).toContain('Update auf 1.5.0 gestartet');
    });

    it('checks for updates and shows the result', async () => {
      const current = { ...WITH_UPDATE, device: { ...WITH_UPDATE.device, updateStable: null, updateCheckedAt: null } };
      const { fixture, el } = await render(current);
      expect(el.textContent).toContain('noch nicht geprüft');
      button(el, 'Auf Updates prüfen')?.click();
      http
        .expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/firmware/check' })
        .flush({ stable: null, beta: '1.6.0-beta1', checkedAt: '2026-10-15T08:00:00.000Z' });
      await settle(fixture, current);
      expect(feedback.toasts).toContain('Firmware ist aktuell; Beta 1.6.0-beta1 verfügbar.');
      expect(button(el, 'Beta installieren')).toBeDefined();
    });
  });

  it('compares two snapshots, older one as "before"', async () => {
    const latest = { id: 2, takenAt: '2026-10-15T08:00:00.000Z', confirmedAt: '2026-10-16T12:00:00.000Z', info: {}, config: { sys: { device: { name: 'Neu' } }, ws: { enable: true } }, status: {} };
    const older = { id: 1, takenAt: '2026-10-14T08:00:00.000Z', confirmedAt: null, info: {}, config: { sys: { device: { name: 'Alt' } }, mqtt: { enable: false } }, status: {} };
    const details: DeviceDetails = {
      ...DETAILS,
      latestSnapshot: latest,
      snapshots: [
        { id: 2, takenAt: latest.takenAt, confirmedAt: latest.confirmedAt, hasConfig: true },
        { id: 1, takenAt: older.takenAt, confirmedAt: null, hasConfig: true },
      ],
    };
    const { fixture, el } = await render(details);
    // Unchanged rescans confirm the latest snapshot instead of adding new ones.
    const options = [...el.querySelectorAll('kern-select:not([name]) option')].map((o) => o.textContent?.trim());
    expect(options[0]).toContain('(neuster) – bestätigt bis 16.10.2026');
    expect(options[1]).not.toContain('bestätigt');
    expect(el.querySelector('.snapshot-confirmed')?.textContent).toContain('unverändert bestätigt bis 16.10.2026');
    // The shown (latest) snapshot is not offered as comparison partner.
    expect([...el.querySelectorAll<HTMLOptionElement>('kern-select[name="compare"] option')].map((o) => o.value)).toEqual(['', '1']);
    setKernValue(el, 'kern-select[name="compare"]', '1');
    await new Promise((r) => setTimeout(r));
    http.expectOne('/api/devices/A8032AB67890/snapshots/1').flush(older);
    await fixture.whenStable();

    expect(el.textContent).toContain('3 Unterschiede: 1 geändert, 1 neu, 1 entfernt');
    const headers = [...el.querySelectorAll('table.diff thead th')].map((th) => th.textContent?.trim());
    expect(headers[1]).not.toContain('bestätigt');
    expect(headers[2]).toContain('bestätigt bis 16.10.2026');
    const rows = [...el.querySelectorAll('table.diff tbody tr')].map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent?.trim()));
    expect(rows).toEqual([
      ['mqtt', '{"enable":false}', '', 'entfernt'],
      ['sys.device.name', '"Alt"', '"Neu"', 'geändert'],
      ['ws', '', '{"enable":true}', 'neu'],
    ]);
  });

  it('switches between config, status and device info with kern-tabs', async () => {
    const latest = { id: 2, takenAt: '2026-10-15T08:00:00.000Z', confirmedAt: null, info: { id: 'x' }, config: { ws: { enable: true } }, status: { uptime: 5 } };
    const { fixture, el } = await render({ ...DETAILS, latestSnapshot: latest, snapshots: [{ id: 2, takenAt: latest.takenAt, confirmedAt: null, hasConfig: true }] });
    const json = () => (el.querySelector('kern-json') as (Element & { data?: unknown }) | null)?.data;
    expect([...el.querySelectorAll('kern-tab-panel')].map((p) => p.getAttribute('label'))).toEqual(['Config', 'Status', 'Geräteinfo']);
    expect(json()).toEqual({ ws: { enable: true } });
    el.querySelector('kern-tabs')?.dispatchEvent(new CustomEvent('kernTabChange', { detail: { value: 'status' } }));
    await fixture.whenStable();
    expect(json()).toEqual({ uptime: 5 });
    expect(el.querySelectorAll('kern-json')).toHaveLength(1);
  });

  it('names the template and summarizes the outcome in the recent actions', async () => {
    const fixture = TestBed.createComponent(DevicePage);
    fixture.componentRef.setInput('mac', DETAILS.device.mac);
    fixture.detectChanges();
    for (const req of http.match((r) => r.method === 'GET')) {
      if (req.request.url.startsWith('/api/actions')) {
        req.flush([
          {
            id: 3, mac: DETAILS.device.mac, deviceName: null, action: 'apply_template', requestedAt: '2026-10-15T17:53:24.000Z',
            requestedBy: '127.0.0.1', finishedAt: '2026-10-15T17:53:25.000Z', result: 'ok', errorCode: null, error: null,
            details: { templateName: 'test', changes: [{ key: 'wifiAp.enable', from: false, to: true }, { key: 'mqtt.password', from: '********', to: '********' }], rebooted: true },
          },
          {
            id: 2, mac: DETAILS.device.mac, deviceName: null, action: 'apply_template', requestedAt: '2026-10-15T17:46:18.000Z',
            requestedBy: '127.0.0.1', finishedAt: '2026-10-15T17:46:18.000Z', result: 'error', errorCode: 'template_failed',
            error: 'Applying failed after 0 of 1 calls', details: { templateName: 'test', appliedSteps: [] },
          },
        ]);
      } else if (req.request.url.startsWith('/api/devices?') || req.request.url === '/api/sites') req.flush([]);
      else req.flush(DETAILS);
    }
    await new Promise((r) => setTimeout(r));
    TestBed.tick();
    for (const req of http.match((r) => r.method === 'GET')) req.flush([]);
    await fixture.whenStable();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('table.compact tr')];
    const text = rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
    expect(text[0]).toContain('Template «test»');
    expect(text[0]).toContain('OK · 2 geändert, neu gestartet');
    expect((rows[0]?.querySelector('td:last-child kern-tooltip') as (Element & { text?: string }) | null)?.text).toContain('Access-Point an: Aus → Ein');
    expect(text[1]).toContain('Template «test»');
    expect(text[1]).toContain('Template konnte nicht vollständig angewendet werden');
  });

  it('moves the device to another site after confirmation', async () => {
    const fixture = TestBed.createComponent(DevicePage);
    fixture.componentRef.setInput('mac', DETAILS.device.mac);
    fixture.detectChanges();
    const sites = [
      { id: 1, name: 'Standard', description: null, createdAt: '2026-10-17T10:00:00.000Z', deviceCount: 1, templateCount: 0 },
      { id: 2, name: 'Ferienhaus', description: null, createdAt: '2026-10-17T10:00:00.000Z', deviceCount: 0, templateCount: 0 },
    ];
    for (let i = 0; i < 2; i++) {
      for (const req of http.match((r) => r.method === 'GET')) {
        if (req.request.url === '/api/sites') req.flush(sites);
        else if (req.request.url.startsWith('/api/devices?') || req.request.url.startsWith('/api/actions')) req.flush([]);
        else req.flush(DETAILS);
      }
      await new Promise((r) => setTimeout(r));
      TestBed.tick();
    }
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    feedback.answer = false;
    setKernValue(el, 'kern-select[name="site"]', '2');
    await tick();
    expect(feedback.questions.at(-1)?.heading).toBe('Nach «Ferienhaus» verschieben?');
    http.expectNone({ method: 'PATCH' });
    expect(el.querySelector<HTMLInputElement>('kern-select[name="site"]')?.value).toBe('1');
    feedback.answer = true;
    setKernValue(el, 'kern-select[name="site"]', '2');
    await tick();
    const patch = http.expectOne({ method: 'PATCH', url: '/api/devices/A8032AB67890' });
    expect(patch.request.body).toEqual({ siteId: 2 });
    patch.flush({ ...DETAILS.device, siteId: 2 });
    for (let i = 0; i < 2; i++) {
      await tick();
      for (const req of http.match((r) => r.method === 'GET')) req.flush(req.request.url === '/api/sites' ? sites : req.request.url.startsWith('/api/devices/') ? DETAILS : []);
    }
    await fixture.whenStable();
    expect(feedback.toasts).toContain('Gerät nach «Ferienhaus» verschoben.');
  });
});
