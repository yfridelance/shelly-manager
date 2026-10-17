import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { SiteService } from './core/site.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('shows the server as connected when /api/health answers ok', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/health').flush({ status: 'ok' });
    http.expectOne('/api/sites').flush([]);
    await fixture.whenStable();
    const el = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="health"]');
    expect(el?.textContent).toContain('Server verbunden');
  });

  it('shows the server as unreachable when /api/health fails', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/health').flush(null, { status: 502, statusText: 'Bad Gateway' });
    http.expectOne('/api/sites').flush([]);
    await fixture.whenStable();
    const el = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="health"]');
    expect(el?.textContent).toContain('Server nicht erreichbar');
  });

  it('switches the site and falls back to the first one when the remembered site is gone', async () => {
    localStorage.setItem('shelly-manager.site', '9');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/health').flush({ status: 'ok' });
    http.expectOne('/api/sites').flush([
      { id: 1, name: 'Standard', description: null, createdAt: '2026-10-17T10:00:00.000Z', deviceCount: 3, templateCount: 1 },
      { id: 2, name: 'Ferienhaus', description: null, createdAt: '2026-10-17T10:00:00.000Z', deviceCount: 0, templateCount: 0 },
    ]);
    await fixture.whenStable();
    const site = TestBed.inject(SiteService);
    expect(site.siteId()).toBe(1);

    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('select[name="site"]');
    expect([...(select?.options ?? [])].map((o) => o.textContent?.trim())).toEqual(['Standard', 'Ferienhaus']);
    if (!select) throw new Error('no site select');
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    expect(site.siteId()).toBe(2);
    expect(localStorage.getItem('shelly-manager.site')).toBe('2');
    localStorage.removeItem('shelly-manager.site');
  });
});
