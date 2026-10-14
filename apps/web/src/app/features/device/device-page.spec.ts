import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { DeviceDetails } from '../../core/api.types';
import { DevicePage } from './device-page';

const DETAILS: DeviceDetails = {
  device: {
    mac: 'A8032AB67890', ip: '10.0.0.4', gen: 2, model: 'SNSW-102P16EU', app: 'Plus2PM', firmware: '20241011-114455/1.4.4-g6d2a586',
    name: 'Rollladen Büro', deviceName: 'Rollladen Büro', authRequired: true, location: null, notes: null, state: 'active',
    firstSeen: '2026-10-14T10:00:00.000Z', lastSeen: '2026-10-14T10:00:00.000Z', lastSnapshotAt: null,
  },
  latestSnapshot: null,
  snapshots: [],
};

/** Lets pending promise chains (firstValueFrom -> catch -> signal) and change detection settle. */
async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
}

describe('DevicePage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DevicePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(DevicePage);
    fixture.componentRef.setInput('mac', 'A8032AB67890');
    fixture.detectChanges();
    http.expectOne('/api/devices/A8032AB67890').flush(DETAILS);
    http.expectOne('/api/devices').flush([]);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('saves the location inline via PATCH', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="Standort bearbeiten"]')?.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('app-editable-field input');
    if (!input) throw new Error('no input');
    input.value = 'Büro OG';
    input.dispatchEvent(new Event('input'));
    input.form?.dispatchEvent(new Event('submit'));

    const patch = http.expectOne({ method: 'PATCH', url: '/api/devices/A8032AB67890' });
    expect(patch.request.body).toEqual({ location: 'Büro OG' });
    patch.flush({ ...DETAILS.device, location: 'Büro OG' });
    // whenStable() would wait for the pending suggestions reload, so answer it first.
    await new Promise((r) => setTimeout(r));
    http.expectOne('/api/devices').flush([]);
    await settle(fixture);
    expect(el.textContent).toContain('Büro OG');
  });

  it('asks for the password of a protected device and clears it after sending', async () => {
    const { fixture, el } = await render();
    expect(el.textContent).toContain('passwortgeschützt');
    const submit = [...el.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => b.textContent?.includes('Config neu einlesen'));
    expect(submit?.disabled).toBe(true);

    const pw = el.querySelector<HTMLInputElement>('input[name="password"]');
    if (!pw) throw new Error('no password input');
    pw.value = 'gen2-secret';
    pw.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(submit?.disabled).toBe(false);
    pw.form?.dispatchEvent(new Event('submit'));

    const post = http.expectOne({ method: 'POST', url: '/api/devices/A8032AB67890/snapshot' });
    expect(post.request.body).toEqual({ credentials: { password: 'gen2-secret' } });
    await fixture.whenStable();
    expect(pw.value).toBe('');
    post.flush({ error: 'auth_invalid', message: 'rejected' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(el.textContent).toContain('Snapshot fehlgeschlagen: Zugangsdaten falsch');
  });
});
