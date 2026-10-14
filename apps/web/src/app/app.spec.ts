import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

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
    TestBed.inject(HttpTestingController).expectOne('/api/health').flush({ status: 'ok' });
    await fixture.whenStable();
    const el = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="health"]');
    expect(el?.textContent).toContain('Server verbunden');
  });

  it('shows the server as unreachable when /api/health fails', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/health')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    const el = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="health"]');
    expect(el?.textContent).toContain('Server nicht erreichbar');
  });
});
