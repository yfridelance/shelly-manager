import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '../core/i18n/pipes';

/** Shows a value; click «Bearbeiten» to edit inline. Enter (Ctrl+Enter for multiline) saves, Escape cancels. */
@Component({
  selector: 'app-editable-field',
  imports: [TranslatePipe],
  template: `
    @if (editing()) {
      <form class="edit" (submit)="save($event)">
        @if (multiline()) {
          <textarea #box rows="4" [value]="draft()" (input)="draft.set(text($event))" (keydown)="onKey($event)"></textarea>
        } @else {
          <input #box [value]="draft()" [attr.list]="listId()" (input)="draft.set(text($event))" (keydown)="onKey($event)" />
        }
        <div class="actions">
          <button type="submit" [disabled]="saving()">{{ 'common.save' | t }}</button>
          <button type="button" class="secondary" (click)="cancel()">{{ 'common.cancel' | t }}</button>
        </div>
      </form>
    } @else {
      <div class="view">
        <span class="value" [class.empty]="!value()">{{ value() || (placeholder() ?? ('common.notRecorded' | t)) }}</span>
        <button type="button" class="link" [attr.aria-label]="'common.editLabel' | t: { label: label() }" (click)="start()">{{ 'common.edit' | t }}</button>
      </div>
    }
  `,
  styles: `
    .view { display: flex; gap: 0.75rem; align-items: baseline; }
    .value { white-space: pre-wrap; }
    .value.empty { color: var(--text-muted); font-style: italic; }
    .edit { display: grid; gap: 0.4rem; max-width: 36rem; }
    .actions { display: flex; gap: 0.5rem; }
  `,
})
export class EditableField {
  readonly label = input.required<string>();
  readonly value = input<string | null>(null);
  /** Default: «nicht erfasst» in the current language. */
  readonly placeholder = input<string | null>(null);
  readonly multiline = input(false);
  /** id of a <datalist> with suggestions. */
  readonly listId = input<string | null>(null);
  readonly saving = input(false);
  readonly saved = output<string>();

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  private readonly box = viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>('box');

  protected start(): void {
    this.draft.set(this.value() ?? '');
    this.editing.set(true);
    setTimeout(() => this.box()?.nativeElement.focus());
  }

  protected cancel(): void {
    this.editing.set(false);
  }

  protected save(event?: Event): void {
    event?.preventDefault();
    this.saved.emit(this.draft());
    this.editing.set(false);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
    if (this.multiline() && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) this.save(event);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
