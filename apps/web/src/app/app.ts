import { CUSTOM_ELEMENTS_SCHEMA, Component, OnInit, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HealthService } from './core/health.service';
import { I18nService } from './core/i18n/i18n.service';
import { TranslatePipe } from './core/i18n/pipes';
import { kernValue } from './core/kern';
import { SiteService, SitesStore } from './core/site.service';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  selector: 'app-root',
  // kern-* web components (registered in main.ts via defineKern)
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly health = inject(HealthService);
  protected readonly site = inject(SiteService);
  protected readonly sites = inject(SitesStore);
  protected readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  /** Kern status modifier for the server health indicator. */
  protected readonly healthTone = computed(() => {
    const state = this.health.state();
    return state === 'ok' ? 'ok' : state === 'down' ? 'danger' : 'busy';
  });

  constructor() {
    // A remembered site that no longer exists: fall back to the first one.
    effect(() => {
      const list = this.sites.list.value();
      if (list.length > 0 && !list.some((s) => s.id === this.site.siteId())) this.site.select(list[0]?.id ?? 1);
    });
  }

  ngOnInit(): void {
    this.health.check();
  }

  protected selectSite(event: Event): void {
    this.site.select(Number(kernValue(event)));
  }

  protected manageSites(): void {
    void this.router.navigate(['/standorte']);
  }

  protected selectLanguage(event: Event): void {
    void this.i18n.use(kernValue(event));
  }
}
