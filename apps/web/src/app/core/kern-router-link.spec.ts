import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { KernRouterLink } from './kern-router-link';

@Component({
  imports: [KernRouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <kern-button href="/templates/neu">Neu</kern-button>
    <kern-button href="/api/export.csv">CSV</kern-button>
    <kern-link href="https://example.com">extern</kern-link>
  `,
})
class Host {}

describe('KernRouterLink', () => {
  it('routes app paths through the Angular router and leaves API and external links alone', async () => {
    await TestBed.configureTestingModule({ imports: [Host], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fire = (el: Element) => {
      const event = new CustomEvent('kernNavigate', { detail: { href: el.getAttribute('href') }, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const [app, api] = fixture.nativeElement.querySelectorAll('kern-button');
    expect(fire(app)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/templates/neu');
    expect(fire(api)).toBe(false);
    expect(fire(fixture.nativeElement.querySelector('kern-link'))).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
