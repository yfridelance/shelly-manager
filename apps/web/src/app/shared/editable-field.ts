import { CUSTOM_ELEMENTS_SCHEMA, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '../core/i18n/pipes';
import { kernValue } from '../core/kern';

/** Shows a value; click «Bearbeiten» to edit inline. Enter (Ctrl+Enter for multiline) saves, Escape cancels. */
@Component({
  selector: 'app-editable-field',
  imports: [TranslatePipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (editing()) {
      <form class="edit" (submit)="save($event)">
        @if (multiline()) {
          <kern-textarea #box [rows]="4" [ariaLabelText]="label()" [value]="draft()" (kernInput)="draft.set(fieldValue($event))" (keydown)="onKey($event)" />
        } @else {
          <kern-input
            #box
            size="sm"
            autocomplete="off"
            [ariaLabelText]="label()"
            [suggestions]="suggestions()"
            [value]="draft()"
            (kernInput)="draft.set(fieldValue($event))"
            (keydown)="onKey($event)"
          />
        }
        <div class="actions">
          <kern-button type="submit" size="sm" variant="primary" [disabled]="saving()">{{ 'common.save' | t }}</kern-button>
          <kern-button size="sm" variant="ghost" (click)="cancel()">{{ 'common.cancel' | t }}</kern-button>
          @if (suggestion(); as s) {
            @if (s !== draft()) {
              <kern-tooltip [text]="s">
                <kern-button size="sm" variant="ghost" (click)="draft.set(s)">{{ 'common.insertSuggestion' | t }}</kern-button>
              </kern-tooltip>
            }
          }
        </div>
      </form>
    } @else {
      <div class="view">
        <span class="value" [class.empty]="!value()">{{ value() || (placeholder() ?? ('common.notRecorded' | t)) }}</span>
        <kern-button size="sm" variant="ghost" class="edit-button" [attr.label]="'common.editLabel' | t: { label: label() }" (click)="start()">{{ 'common.edit' | t }}</kern-button>
        @if (suggestion(); as s) {
          @if (s !== value()) {
            <kern-tooltip [text]="'common.suggestionHint' | t">
              <kern-button size="sm" variant="ghost" class="suggestion" (click)="edit(s)">{{ 'common.useSuggestion' | t: { value: s } }}</kern-button>
            </kern-tooltip>
          }
        }
      </div>
    }
  `,
  styles: `
    .view { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; min-height: var(--control-sm); }
    .value { white-space: pre-wrap; }
    .value.empty { color: var(--text-muted); font-style: italic; }
    .edit { display: grid; gap: var(--space-2); max-width: 36rem; }
    .actions { display: flex; gap: var(--space-2); }
  `,
})
export class EditableField {
  readonly label = input.required<string>();
  readonly value = input<string | null>(null);
  /** Default: «nicht erfasst» in the current language. */
  readonly placeholder = input<string | null>(null);
  readonly multiline = input(false);
  /** Offered while typing (kern-input combobox); free text stays allowed. */
  readonly suggestions = input<string[]>([]);
  readonly saving = input(false);
  /** Offered next to «Bearbeiten» and in the editor; taking it only fills the editor, saving stays a separate step. */
  readonly suggestion = input<string | null>(null);
  readonly saved = output<string>();

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  private readonly box = viewChild<ElementRef<HTMLElement & { setFocus?: () => Promise<void> }>>('box');

  protected start(): void {
    this.edit();
  }

  /** Opens the editor, optionally pre-filled with a suggestion instead of the current value (not saved yet). */
  edit(initial?: string): void {
    this.draft.set(initial ?? this.value() ?? '');
    this.editing.set(true);
    setTimeout(() => void this.box()?.nativeElement.setFocus?.());
  }

  protected cancel(): void {
    this.editing.set(false);
  }

  protected save(event?: Event): void {
    event?.preventDefault();
    this.saved.emit(this.draft());
    this.editing.set(false);
  }

  /**
   * Enter saves (Ctrl+Enter when multiline), Escape cancels. kern-input handles both first while its suggestion
   * list is open (taking a suggestion, closing the list) and then marks the event as handled.
   */
  protected onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') this.cancel();
    if (event.key === 'Enter' && (!this.multiline() || event.ctrlKey || event.metaKey)) this.save(event);
  }

  protected readonly fieldValue = kernValue;
}
