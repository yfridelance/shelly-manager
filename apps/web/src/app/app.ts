import { Component, OnInit, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HealthService } from './core/health.service';
import { I18nService } from './core/i18n/i18n.service';
import { TranslatePipe } from './core/i18n/pipes';
import { SiteService, SitesStore } from './core/site.service';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly health = inject(HealthService);
  protected readonly site = inject(SiteService);
  protected readonly sites = inject(SitesStore);
  protected readonly i18n = inject(I18nService);

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
    this.site.select(Number((event.target as HTMLSelectElement).value));
  }

  protected selectLanguage(event: Event): void {
    void this.i18n.use((event.target as HTMLSelectElement).value);
  }
}
