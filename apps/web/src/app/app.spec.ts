import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { kernValueOf, setKernValue } from '../testing/kern';
import { SiteService } from './core/site.service';
import { activateLanguage } from './core/i18n/i18n';
import { I18N_LANGUAGES } from './core/i18n/i18n.service';
import { LANGUAGES, type Language } from './core/i18n/languages';

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

    const root = fixture.nativeElement as HTMLElement;
    expect([...root.querySelectorAll('kern-select[name="site"] option')].map((o) => o.textContent?.trim())).toEqual(['Standard', 'Ferienhaus']);
    expect(kernValueOf(root, 'kern-select[name="site"]')).toBe('1');
    setKernValue(root, 'kern-select[name="site"]', '2');
    expect(root.querySelector('kern-select[name="site"] kern-button[slot="footer"]')?.textContent).toContain('Standorte bearbeiten');
    expect(site.siteId()).toBe(2);
    expect(localStorage.getItem('shelly-manager.site')).toBe('2');
    localStorage.removeItem('shelly-manager.site');
  });

  it('shows the language switcher only with more than one language and switches without reload', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: I18N_LANGUAGES, useValue: [LANGUAGES[0]] }],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/health').flush({ status: 'ok' });
    http.expectOne('/api/sites').flush([]);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('kern-select[name="language"]')).toBeNull();

    TestBed.resetTestingModule();
    const en: Language = { code: 'en', locale: 'en-GB', name: 'English', load: async () => ({ nav: { inventory: 'Inventory' } }) };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: I18N_LANGUAGES, useValue: [LANGUAGES[0], en] }],
    }).compileComponents();
    const second = TestBed.createComponent(App);
    second.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/health').flush({ status: 'ok' });
    TestBed.inject(HttpTestingController).expectOne('/api/sites').flush([]);
    await second.whenStable();
    const el = second.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('kern-select[name="language"] option')].map((o) => o.textContent?.trim())).toEqual(['Deutsch', 'English']);
    setKernValue(el, 'kern-select[name="language"]', 'en');
    await new Promise((r) => setTimeout(r));
    await second.whenStable();
    const nav = [...el.querySelectorAll('a[slot="nav"]')].map((a) => a.textContent).join(' ');
    expect(nav).toContain('Inventory');
    expect(nav).toContain('Scan');
    activateLanguage('de', 'de-CH');
    localStorage.removeItem('shelly-manager.lang');
  });
});
