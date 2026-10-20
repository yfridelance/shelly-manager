import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { Site } from '../../core/api.types';
import { SitesPage } from './sites-page';

const SITES: Site[] = [
  { id: 1, name: 'Standard', description: null, createdAt: '2026-10-17T10:00:00.000Z', deviceCount: 6, templateCount: 1 },
  { id: 2, name: 'Ferienhaus', description: 'Engadin', createdAt: '2026-10-17T11:00:00.000Z', deviceCount: 0, templateCount: 0 },
];

import { setKernValue } from '../../../testing/kern';
import { FeedbackStub, provideFeedbackStub } from '../../../testing/feedback';
import { Feedback } from '../../core/feedback';
describe('SitesPage', () => {
  let http: HttpTestingController;
  let feedback: FeedbackStub;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SitesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideFeedbackStub()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    feedback = TestBed.inject(Feedback) as FeedbackStub;
  });

  async function render() {
    const fixture = TestBed.createComponent(SitesPage);
    fixture.detectChanges();
    http.expectOne('/api/sites').flush(SITES);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string, root: ParentNode = el) => [...root.querySelectorAll<HTMLElement>('kern-button')].find((b) => b.textContent?.trim() === text);
    return { fixture, el, button };
  }

  it('lists sites with counts and offers delete only for empty ones', async () => {
    const { el } = await render();
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' '))).toEqual([
      expect.stringContaining('Standard'),
      expect.stringContaining('Ferienhaus'),
    ]);
    expect(rows[0]?.textContent).toContain('aktuell');
    expect([...(rows[0]?.querySelectorAll('kern-button') ?? [])].some((b) => b.textContent?.trim() === 'Löschen')).toBe(false);
    expect([...(rows[1]?.querySelectorAll('kern-button') ?? [])].some((b) => b.textContent?.trim() === 'Löschen')).toBe(true);
  });

  it('creates a site', async () => {
    const { fixture, el } = await render();
    setKernValue(el, 'kern-input[name="siteName"]', 'Büro');
    await fixture.whenStable();
    // jsdom does not upgrade kern-button: submit the form directly.
    el.querySelector('.create form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne({ method: 'POST', url: '/api/sites' });
    expect(req.request.body).toEqual({ name: 'Büro', description: null });
    req.flush({ ...SITES[1], id: 3, name: 'Büro' });
    await new Promise((r) => setTimeout(r));
    http.expectOne('/api/sites').flush([...SITES, { ...SITES[1], id: 3, name: 'Büro' }]);
    await fixture.whenStable();
    expect(feedback.toasts).toContain('Standort «Büro» angelegt.');
  });

  it('deletes an empty site after confirmation', async () => {
    const { fixture, el, button } = await render();
    const row = el.querySelectorAll('tbody tr')[1] as HTMLElement;
    feedback.answer = false;
    button('Löschen', row)?.click();
    await new Promise((r) => setTimeout(r));
    http.expectNone({ method: 'DELETE' });
    expect(feedback.questions.at(-1)).toMatchObject({ heading: '«Ferienhaus» löschen?', danger: true });
    feedback.answer = true;
    button('Löschen', row)?.click();
    await new Promise((r) => setTimeout(r));
    http.expectOne({ method: 'DELETE', url: '/api/sites/2' }).flush(null);
    await new Promise((r) => setTimeout(r));
    TestBed.tick();
    http.expectOne('/api/sites').flush([SITES[0]]);
    await fixture.whenStable();
    expect(feedback.toasts).toContain('Standort «Ferienhaus» gelöscht.');
  });
});
