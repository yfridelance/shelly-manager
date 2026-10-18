import { Pipe, type PipeTransform } from '@angular/core';
import { formatDate, t, type DateStyle, type TranslationKey, type TranslationParams } from './i18n';

// Impure: the result depends on the current language, not only on the arguments.
// The lookups are cheap map reads.

/** `{{ 'scan.title' | t }}`, `{{ 'scan.found' | t: { count: n } }}` */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  transform(key: TranslationKey, params?: TranslationParams): string {
    return t(key, params);
  }
}

/** `{{ iso | dateTime: 'seconds' }}`: local time in the current locale. */
@Pipe({ name: 'dateTime', pure: false })
export class DateTimePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined, style: DateStyle = 'minutes'): string {
    return formatDate(value, style);
  }
}

/**
 * Emphasis inside a translated sentence: `**text**` becomes <strong>. Everything else is escaped,
 * so translations cannot inject markup. Use with `[innerHTML]="'key' | t | emphasis"`.
 */
@Pipe({ name: 'emphasis' })
export class EmphasisPipe implements PipeTransform {
  transform(text: string): string {
    const escaped = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
}
