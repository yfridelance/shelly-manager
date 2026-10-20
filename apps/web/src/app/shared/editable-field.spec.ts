import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { setKernValue } from '../../testing/kern';
import { EditableField } from './editable-field';

@Component({
  imports: [EditableField],
  template: `<app-editable-field label="Ort" [value]="value()" [suggestions]="['Küche', 'Bad']" (saved)="saved.push($event)" />`,
})
class Host {
  readonly value = signal<string | null>('Bad');
  readonly saved: string[] = [];
}

describe('EditableField', () => {
  async function open() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLElement>('kern-button.edit-button')?.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLElement & { suggestions?: string[]; value?: string }>('kern-input');
    return { fixture, el, input, host: fixture.componentInstance };
  }

  const key = (el: Element | null, k: string, handled = false) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    if (handled) event.preventDefault(); // kern-input took the key for its suggestion list
    el?.dispatchEvent(event);
  };

  it('edits in a kern-input with suggestions and saves on Enter', async () => {
    const { fixture, input, host } = await open();
    expect(input?.suggestions).toEqual(['Küche', 'Bad']);
    expect(input?.value).toBe('Bad');
    setKernValue(fixture.nativeElement, 'kern-input', 'Küche');
    key(input, 'Enter');
    expect(host.saved).toEqual(['Küche']);
  });

  it('leaves Enter and Escape to the open suggestion list, otherwise Escape cancels', async () => {
    const { fixture, el, input, host } = await open();
    key(input, 'Enter', true);
    key(input, 'Escape', true);
    await fixture.whenStable();
    expect(host.saved).toEqual([]);
    expect(el.querySelector('kern-input')).not.toBeNull();
    key(input, 'Escape');
    await fixture.whenStable();
    expect(el.querySelector('kern-input')).toBeNull();
    expect(host.saved).toEqual([]);
  });
});
