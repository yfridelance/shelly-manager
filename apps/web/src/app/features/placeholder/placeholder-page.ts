import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-placeholder-page',
  template: `<h1>{{ title }}</h1><p class="muted">Diese Ansicht folgt in einer späteren Phase.</p>`,
})
export class PlaceholderPage {
  protected readonly title = (inject(ActivatedRoute).snapshot.data['title'] as string | undefined) ?? '';
}
