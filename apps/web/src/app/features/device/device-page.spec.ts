import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { DeviceDetails } from '../../core/api.types';
import { DevicePage } from './device-page';

const DETAILS: DeviceDetails = {
  device: {
    mac: 'A8032AB67890', ip: '10.0.0.4', gen: 2, model: 'SNSW-102P16EU', app: 'Plus2PM', firmware: '20241011-114455/1.4.4-g6d2a586',
    name: 'Rollladen Büro', deviceName: 'Rollladen Büro', deviceId: 'shellyplus2pm-a8032ab67890', siteId: 1, authRequired: true, location: null, notes: null, kind: null, functions: null, state: 'active',
    firstSeen: '2026-10-14T10:00:00.000Z', lastSeen: '2026-10-14T10:00:00.000Z', lastSnapshotAt: null,
    updateStable: null, updateBeta: null, updateCheckedAt: null,
  },
  latestSnapshot: null,
  snapshots: [],
};

describe('DevicePage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DevicePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
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
    const input = el as HTMLInputElement | null;
    if (!input) throw new Error('input missing');
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));

  it('saves the location inline via PATCH', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="Ort bearbeiten"]')?.click();
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

  it('shows the derived function and saves the type', async () => {
    const functions = { switch: 0, cover: 1, light: 0, meter: 0, input: 2, sensor: 0, metering: true };
    const { fixture, el } = await render({ ...DETAILS, device: { ...DETAILS.device, functions } });
    expect(el.textContent).toContain('Rollladen · Messung');
    el.querySelector<HTMLButtonElement>('button[aria-label="Typ bearbeiten"]')?.click();
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
    type(el.querySelector('input[name="password"]'), 'gen2-secret');
    await fixture.whenStable();
    button(el, 'Config neu einlesen')?.click();

    const post = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/snapshot' });
    expect(post.request.body).toEqual({ credentials: { password: 'gen2-secret' } });
    post.flush({ error: 'auth_invalid', message: 'rejected' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(el.querySelector<HTMLInputElement>('input[name="password"]')?.value).toBe('');
    expect(el.textContent).toContain('Snapshot fehlgeschlagen: Zugangsdaten falsch');
  });

  it('asks before rebooting', async () => {
    const open = { ...DETAILS, device: { ...DETAILS.device, authRequired: false } };
    const { fixture, el } = await render(open);
    button(el, 'Neu starten')?.click();
    await fixture.whenStable();
    http.expectNone({ method: 'POST' });
    button(el, 'Ja, neu starten')?.click();
    http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/reboot' }).flush({ ok: true });
    await settle(fixture, open);
    expect(el.textContent).toContain('Neustart ausgelöst');
  });

  describe('factory reset dialog', () => {
    const OPEN = { ...DETAILS, device: { ...DETAILS.device, authRequired: false } };

    async function openDialog(details: DeviceDetails = OPEN) {
      const r = await render(details);
      button(r.el, 'Werkseinstellungen')?.click();
      await r.fixture.whenStable();
      const dialog = r.el.querySelector<HTMLElement>('[role="dialog"]');
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
        type(dialog.querySelector('input[name="confirm"]'), wrong);
        await fixture.whenStable();
        expect(submit?.disabled).toBe(true);
      }
      for (const right of ['a8:03:2a:b6:78:90', 'A8032AB67890', 'rollladen büro']) {
        type(dialog.querySelector('input[name="confirm"]'), right);
        await fixture.whenStable();
        expect(submit?.disabled).toBe(false);
      }
      http.expectNone({ method: 'POST' });
    });

    it('sends exactly this MAC and reports success', async () => {
      const { fixture, el, dialog } = await openDialog();
      type(dialog.querySelector('input[name="confirm"]'), 'Rollladen Büro');
      await fixture.whenStable();
      button(dialog, 'Endgültig zurücksetzen')?.click();

      const req = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' });
      expect(req.request.body).toEqual({ confirmMac: 'A8032AB67890' });
      req.flush({ snapshotId: 42, confirmed: true });
      await settle(fixture, OPEN);
      expect(el.querySelector('[role="dialog"]')).toBeNull();
      expect(el.textContent).toContain('startet jetzt im AP-Modus');
      expect(el.textContent).not.toContain('vermutlich');
    });

    it('reports an unconfirmed reset when the device dropped the connection', async () => {
      const { fixture, el, dialog } = await openDialog();
      type(dialog.querySelector('input[name="confirm"]'), 'A8032AB67890');
      await fixture.whenStable();
      button(dialog, 'Endgültig zurücksetzen')?.click();
      http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' }).flush({ snapshotId: 42, confirmed: false });
      await settle(fixture, OPEN);
      expect(el.querySelector('[role="dialog"]')).toBeNull();
      expect(el.textContent).toContain('Reset vermutlich erfolgreich – Gerät nicht mehr erreichbar');
      expect(el.textContent).toContain('Die Config wurde vorher gesichert.');
    });

    it('offers the override only after the snapshot failed', async () => {
      const { fixture, dialog } = await openDialog();
      expect(dialog.querySelector('input[name="override"]')).toBeNull();
      type(dialog.querySelector('input[name="confirm"]'), 'A8032AB67890');
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
      const override = dialog.querySelector<HTMLInputElement>('input[name="override"]');
      if (!override) throw new Error('no override checkbox');
      override.checked = true;
      override.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(submit?.disabled).toBe(false);
      submit?.click();

      const second = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' });
      expect(second.request.body).toEqual({ confirmMac: 'A8032AB67890', allowWithoutSnapshot: true });
    });

    it('sends the password of a protected device and clears it', async () => {
      const { fixture, dialog } = await openDialog(DETAILS);
      type(dialog.querySelector('input[name="confirm"]'), 'A8032AB67890');
      await fixture.whenStable();
      expect(button(dialog, 'Endgültig zurücksetzen')?.disabled).toBe(true);
      type(dialog.querySelector('input[name="password"]'), 'gen2-secret');
      await fixture.whenStable();
      button(dialog, 'Endgültig zurücksetzen')?.click();
      const req = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/factory-reset' });
      expect(req.request.body).toEqual({ confirmMac: 'A8032AB67890', credentials: { password: 'gen2-secret' } });
      req.flush({ error: 'busy', message: 'x' }, { status: 409, statusText: 'Conflict' });
      await settle(fixture, DETAILS);
      expect(dialog.querySelector<HTMLInputElement>('input[name="password"]')?.value).toBe('');
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

      button(el, 'Update installieren')?.click();
      await fixture.whenStable();
      http.expectNone({ method: 'POST' });
      expect(el.textContent).toContain('Das Gerät startet danach neu');

      button(el, 'Ja, installieren')?.click();
      const req = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/firmware/update' });
      expect(req.request.body).toEqual({ channel: 'stable' });
      req.flush({ version: '1.5.0' });
      await settle(fixture, WITH_UPDATE);
      expect(el.textContent).toContain('Update auf 1.5.0 gestartet');
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
      expect(el.textContent).toContain('Firmware ist aktuell; Beta 1.6.0-beta1 verfügbar.');
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
    const options = [...el.querySelectorAll('select:not([name]) option')].map((o) => o.textContent?.trim());
    expect(options[0]).toContain('(neuster) – bestätigt bis 16.10.2026');
    expect(options[1]).not.toContain('bestätigt');
    expect(el.querySelector('.snapshot-confirmed')?.textContent).toContain('unverändert bestätigt bis 16.10.2026');
    const select = el.querySelector<HTMLSelectElement>('select[name="compare"]');
    if (!select) throw new Error('no compare select');
    // The shown (latest) snapshot is not offered as comparison partner.
    expect([...select.options].map((o) => o.value)).toEqual(['', '1']);
    select.value = '1';
    select.dispatchEvent(new Event('change'));
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
    expect(rows[0]?.querySelector('td:last-child')?.getAttribute('title')).toContain('Access-Point an: Aus → Ein');
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
    const select = el.querySelector<HTMLSelectElement>('select[name="site"]');
    if (!select) throw new Error('no site select');
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Nach «Ferienhaus» verschieben?');
    http.expectNone({ method: 'PATCH' });
    button(el, 'Ja, verschieben')?.click();
    const patch = http.expectOne({ method: 'PATCH', url: '/api/devices/A8032AB67890' });
    expect(patch.request.body).toEqual({ siteId: 2 });
    patch.flush({ ...DETAILS.device, siteId: 2 });
    await new Promise((r) => setTimeout(r));
    for (const req of http.match((r) => r.method === 'GET')) req.flush(req.request.url === '/api/sites' ? sites : req.request.url.startsWith('/api/devices/') ? DETAILS : []);
    await fixture.whenStable();
    expect(el.textContent).toContain('Gerät nach «Ferienhaus» verschoben.');
  });
});
