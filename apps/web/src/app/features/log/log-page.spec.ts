import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ActionEntry } from '../../core/api.types';
import { LogPage } from './log-page';

const ENTRIES: ActionEntry[] = [
  { id: 4, mac: 'E868E7A1B2C3', deviceName: null, action: 'factory_reset', requestedAt: '2026-10-14T10:03:00.000Z', requestedBy: '127.0.0.1', finishedAt: '2026-10-14T10:03:04.000Z', result: 'ok', errorCode: null, error: null, details: { snapshotId: 7, confirmed: false, recheck: 'unreachable' } },
  { id: 3, mac: 'A8032AB12345', deviceName: 'Boiler', action: 'factory_reset', requestedAt: '2026-10-14T10:02:00.000Z', requestedBy: '127.0.0.1', finishedAt: '2026-10-14T10:02:01.500Z', result: 'ok', errorCode: null, error: null, details: { snapshotSkipped: true, snapshotError: 'timeout' } },
  { id: 2, mac: 'A8032AB12345', deviceName: 'Boiler', action: 'snapshot', requestedAt: '2026-10-14T10:01:00.000Z', requestedBy: '127.0.0.1', finishedAt: '2026-10-14T10:01:00.200Z', result: 'error', errorCode: 'timeout', error: 'No answer', details: null },
  { id: 1, mac: 'E868E7A1B2C3', deviceName: null, action: 'reboot', requestedAt: '2026-10-14T10:00:00.000Z', requestedBy: '127.0.0.1', finishedAt: '2026-10-14T10:00:00.100Z', result: 'ok', errorCode: null, error: null, details: null },
];

describe('LogPage', () => {
  it('shows actions with German texts, override details and filters', async () => {
    await TestBed.configureTestingModule({
      imports: [LogPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(LogPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/actions?limit=2000').flush(ENTRIES);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
    expect(rows()).toHaveLength(4);
    expect(rows()[0]).toContain('Reset vermutlich erfolgreich – Gerät nicht mehr erreichbar · Config vorher gesichert (Snapshot 7)');
    expect(rows()[1]).toContain('Werksreset');
    expect(rows()[1]).toContain('ohne Snapshot (Override, Zeitüberschreitung)');
    expect(rows()[1]).not.toContain('vermutlich');
    expect(rows()[1]).toContain('1.5 s');
    expect(rows()[2]).toContain('Zeitüberschreitung');
    expect(rows()[3]).toContain('E8:68:E7:A1:B2:C3');

    const result = el.querySelectorAll('select')[1] as HTMLSelectElement;
    result.value = 'error';
    result.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Snapshot');
  });
});
