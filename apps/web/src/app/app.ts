import { Component, OnInit, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HealthService } from './core/health.service';
import { SiteService, SitesStore } from './core/site.service';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly health = inject(HealthService);
  protected readonly site = inject(SiteService);
  protected readonly sites = inject(SitesStore);

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
}
