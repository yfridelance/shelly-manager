import { Directive, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Lets the Angular router handle kern-button / kern-link with an app path in `href`: Kern emits a cancelable
 * `kernNavigate` for plain left clicks (not for Ctrl/Cmd clicks, `target` or `download`), so opening in a new
 * tab still works. API paths (`/api/…`) and external URLs stay normal links.
 */
@Directive({
  selector: 'kern-button[href], kern-link[href], kern-list-item[href]',
  host: { '(kernNavigate)': 'navigate($event)' },
})
export class KernRouterLink {
  private readonly router = inject(Router);

  protected navigate(event: Event): void {
    const href = (event as CustomEvent<{ href: string }>).detail?.href ?? '';
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
    event.preventDefault();
    void this.router.navigateByUrl(href);
  }
}
