/** A UI language. Translations live in `src/locale/<code>.json`, same keys as `de.json`. */
export interface Language {
  /** Short code, also the file name and the value remembered in the browser. */
  code: string;
  /** BCP 47 locale for `<html lang>`, dates, numbers and sorting. */
  locale: string;
  /** Name in the language itself, shown in the switcher. */
  name: string;
  load: () => Promise<object>;
}

/** German is the source language and the fallback for missing keys. */
export const DEFAULT_LANGUAGE = 'de';

/**
 * Available languages. Adding one: create `src/locale/<code>.json` and add one line here, e.g.
 * `{ code: 'en', locale: 'en-GB', name: 'English', load: () => import('../../../locale/en.json').then((m) => m.default) },`
 * Each file is its own chunk and only loaded when the language is used.
 */
export const LANGUAGES: readonly Language[] = [
  { code: 'de', locale: 'de-CH', name: 'Deutsch', load: () => import('../../../locale/de.json').then((m) => m.default) },
];
