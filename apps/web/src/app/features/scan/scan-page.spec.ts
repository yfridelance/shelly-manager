import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ScanDetails } from '../../core/api.types';
import { ScanPage } from './scan-page';
import { kernValueOf, setKernValue } from '../../../testing/kern';

const summary = {
  id: 'scan-1', siteId: 1, range: '10.0.0.0/29', status: 'running' as const, total: 6, scanned: 0, found: 0, errors: 0,
  withCredentials: true, startedAt: '2026-10-14T10:00:00.000Z', finishedAt: null, error: null, missing: [],
};

describe('ScanPage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    // jsdom has no EventSource, so the service polls.
    await TestBed.configureTestingModule({
      imports: [ScanPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  function setInput(el: HTMLElement, name: string, value: string): void {
    setKernValue(el, `kern-input[name="${name}"]`, value);
  }

  it('starts a scan with credentials, clears the password and shows the results', async () => {
    const fixture = TestBed.createComponent(ScanPage);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    http.expectOne('/api/scans?site=1').flush([]);
    await fixture.whenStable();

    setInput(el, 'range', '10.0.0.0/29');
    setInput(el, 'password', 'geheim');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(new Event('submit'));

    const post = http.expectOne({ method: 'POST', url: '/api/scans' });
    expect(post.request.body).toEqual({ range: '10.0.0.0/29', siteId: 1, credentials: { password: 'geheim' } });
    await fixture.whenStable();
    expect(kernValueOf(el, 'kern-input[name="password"]')).toBe('');
    post.flush(summary);
    await fixture.whenStable();

    const details: ScanDetails = {
      ...summary, status: 'done', scanned: 6, found: 2, errors: 1, finishedAt: '2026-10-14T10:00:05.000Z',
      devices: [
        { ip: '10.0.0.3', mac: 'A8032AB12345', gen: 2, model: 'SNSW-001P16EU', name: 'Boiler', deviceId: 'shellyplus1pm-a8032ab12345', authRequired: false, created: true, snapshot: 'ok', errorCode: null, error: null },
        { ip: '10.0.0.2', mac: 'E868E7D4E5F6', gen: 1, model: 'SHSW-25', name: null, deviceId: null, authRequired: true, created: false, snapshot: 'error', errorCode: 'auth_invalid', error: 'rejected' },
      ],
    };
    http.expectOne('/api/scans/scan-1').flush(details);
    await fixture.whenStable();

    const rows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('10.0.0.2');
    expect(rows[0]).toContain('Zugangsdaten falsch');
    expect(rows[1]).toContain('Boiler');
    expect(rows[1]).toContain('shellyplus1pm-a8032ab12345');
    expect(rows[1]).toContain('A8:03:2A:B1:23:45');
    expect(rows[1]).toContain('neu');
    expect(el.textContent).toContain('6 von 6 Adressen geprüft');
    expect(el.textContent).toContain('Abgeschlossen');
  });

  it('shows the server message for an invalid range', async () => {
    const fixture = TestBed.createComponent(ScanPage);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    http.expectOne('/api/scans?site=1').flush([]);
    setInput(el, 'range', '10.0.0.0/8');
    await fixture.whenStable();
    el.querySelector('form')?.dispatchEvent(new Event('submit'));

    http
      .expectOne({ method: 'POST', url: '/api/scans' })
      .flush({ error: 'invalid_range', message: 'Der Bereich umfasst 16777214 Adressen, erlaubt sind höchstens 1024.' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('höchstens 1024');
  });
});
