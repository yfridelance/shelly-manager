import { Component, computed, input } from '@angular/core';

interface Entry {
  key: string;
  value: unknown;
}

/** Collapsible, read-only JSON viewer built on <details>. Recursive. */
@Component({
  selector: 'app-json-tree',
  template: `
    @if (isContainer()) {
      <details [open]="depth() < openDepth()">
        <summary>
          @if (label() !== null) {
            <span class="key">{{ label() }}</span>:
          }
          <span class="meta">{{ isArray() ? '[' + entries().length + ']' : '{' + entries().length + '}' }}</span>
        </summary>
        <div class="children">
          @for (e of entries(); track e.key) {
            <app-json-tree [value]="e.value" [label]="e.key" [depth]="depth() + 1" [openDepth]="openDepth()" />
          }
        </div>
      </details>
    } @else {
      <div class="leaf">
        @if (label() !== null) {
          <span class="key">{{ label() }}</span>:
        }
        <span [class]="'v ' + kind()">{{ text() }}</span>
      </div>
    }
  `,
  styles: `
    :host { display: block; font-family: var(--font-mono); font-size: 12.5px; line-height: 20px; }
    summary { cursor: pointer; }
    .children { padding-left: 1.1rem; border-left: 1px dotted var(--line); margin-left: 0.3rem; }
    .leaf { padding-left: 1rem; white-space: pre-wrap; word-break: break-all; }
    .key { color: var(--json-key); }
    .meta { color: var(--text-muted); }
    .v.string { color: var(--json-string); }
    .v.number { color: var(--json-number); }
    .v.boolean, .v.null { color: var(--json-literal); }
  `,
})
export class JsonTree {
  readonly value = input<unknown>();
  readonly label = input<string | null>(null);
  readonly depth = input(0);
  /** Nodes above this depth start expanded. */
  readonly openDepth = input(1);

  protected readonly isArray = computed(() => Array.isArray(this.value()));
  protected readonly isContainer = computed(() => typeof this.value() === 'object' && this.value() !== null);
  protected readonly entries = computed<Entry[]>(() => {
    const v = this.value();
    if (Array.isArray(v)) return v.map((value, i) => ({ key: String(i), value }));
    if (typeof v === 'object' && v !== null) return Object.entries(v).map(([key, value]) => ({ key, value }));
    return [];
  });
  protected readonly kind = computed(() => {
    const v = this.value();
    return v === null ? 'null' : typeof v;
  });
  protected readonly text = computed(() => {
    const v = this.value();
    return typeof v === 'string' ? JSON.stringify(v) : String(v);
  });
}
