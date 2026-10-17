import { DOCUMENT, Injectable, InjectionToken, inject } from '@angular/core';
import { activateLanguage, addTranslations, currentLanguage, hasTranslations } from './i18n';
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './languages';

/** Overridable in tests. */
export const I18N_LANGUAGES = new InjectionToken<readonly Language[]>('I18N_LANGUAGES', { factory: () => LANGUAGES });

const STORAGE_KEY = 'shelly-manager.lang';

/** Remembered choice, else the first browser language we have, else German. */
export function detectLanguage(languages: readonly Language[], stored: string | null, browser: readonly string[]): string {
  const codes = languages.map((l) => l.code);
  if (stored && codes.includes(stored)) return stored;
  for (const tag of browser) {
    const exact = languages.find((l) => l.locale.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.code;
    const base = tag.toLowerCase().split('-')[0] ?? '';
    if (codes.includes(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

/** Language switching: loads the file, activates it, sets `<html lang>` and remembers the choice per browser. */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly document = inject(DOCUMENT);
  readonly languages = inject(I18N_LANGUAGES);
  readonly language = currentLanguage;

  /** At startup (app initializer), so the first render is already in the right language. */
  async init(): Promise<void> {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // blocked storage: browser language
    }
    const browser = this.document.defaultView?.navigator.languages ?? [];
    await this.activate(detectLanguage(this.languages, stored, browser)).catch(() => this.activate(DEFAULT_LANGUAGE));
  }

  async use(code: string): Promise<void> {
    await this.activate(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // private mode / blocked storage: the choice just is not remembered
    }
  }

  private async activate(code: string): Promise<void> {
    const lang = this.languages.find((l) => l.code === code) ?? this.languages.find((l) => l.code === DEFAULT_LANGUAGE);
    if (!lang) return;
    if (!hasTranslations(lang.code)) addTranslations(lang.code, await lang.load());
    activateLanguage(lang.code, lang.locale);
    this.document.documentElement.lang = lang.locale;
  }
}
