import { computed, signal } from '@angular/core';
import de from '../../../locale/de.json';
import { DEFAULT_LANGUAGE } from './languages';

/*
 * Runtime translations without a library: flat lookups in signals, so templates, computed()
 * and plain functions (texts.ts, action-text.ts …) all re-render when the language changes.
 *
 * Files: nested JSON, i18next v4 conventions (Weblate format "i18next JSON v4"):
 * placeholders `{{name}}`, plural forms as `key_one` / `key_other` (Intl.PluralRules categories),
 * selected through the `count` parameter.
 */

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type BaseKey<K extends string> = K extends `${infer B}_${PluralCategory}` ? B : K;
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${BaseKey<K>}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every key of the source language (plural suffixes removed); checked at compile time, also in templates. */
export type TranslationKey = Leaves<typeof de>;
export type TranslationParams = Record<string, string | number | null | undefined>;

/** Nested JSON -> "a.b.c" map. */
export function flatten(obj: object, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out.set(prefix + k, v);
    else if (v && typeof v === 'object') flatten(v as object, `${prefix}${k}.`, out);
  }
  return out;
}

const source = flatten(de);
const dictionaries = signal<Readonly<Record<string, Map<string, string>>>>({ [DEFAULT_LANGUAGE]: source });
const active = signal({ code: DEFAULT_LANGUAGE, locale: 'de-CH' });

export const currentLanguage = computed(() => active().code);
export const currentLocale = computed(() => active().locale);

/** Makes a loaded language available (also used by tests). */
export function addTranslations(code: string, data: object): void {
  dictionaries.update((d) => ({ ...d, [code]: flatten(data) }));
}

export function hasTranslations(code: string): boolean {
  return code in dictionaries();
}

/** Switches the language; its translations must have been added before. */
export function activateLanguage(code: string, locale: string): void {
  active.set({ code, locale });
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: string, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(locale)));
  return rules.select(count);
}

function lookup(dict: Map<string, string> | undefined, key: string, count: unknown, locale: string): string | undefined {
  if (!dict) return undefined;
  if (typeof count === 'number') return dict.get(`${key}_${pluralCategory(locale, count)}`) ?? dict.get(`${key}_other`) ?? dict.get(key);
  return dict.get(key);
}

/** Text in the current language; missing keys fall back to German, then to the key itself. */
export function t(key: TranslationKey, params?: TranslationParams): string {
  return translate(key, params);
}

/** Like t(), for keys built at runtime (API codes). Returns undefined when even German has no text. */
export function translateOptional(key: string, params?: TranslationParams): string | undefined {
  const { code, locale } = active();
  const all = dictionaries();
  const text = lookup(all[code], key, params?.['count'], locale) ?? lookup(source, key, params?.['count'], 'de-CH');
  if (text === undefined) return undefined;
  return params ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) => (params[name] == null ? m : String(params[name]))) : text;
}

export function translate(key: string, params?: TranslationParams): string {
  return translateOptional(key, params) ?? key;
}

// --- Locale-aware formatting ------------------------------------------------------

export type DateStyle = 'date' | 'minutes' | 'seconds' | 'compact';

const DATE_OPTIONS: Record<DateStyle, [Intl.DateTimeFormatOptions, Intl.DateTimeFormatOptions | null]> = {
  date: [{ day: '2-digit', month: '2-digit', year: 'numeric' }, null],
  minutes: [{ day: '2-digit', month: '2-digit', year: 'numeric' }, { hour: '2-digit', minute: '2-digit' }],
  seconds: [{ day: '2-digit', month: '2-digit', year: 'numeric' }, { hour: '2-digit', minute: '2-digit', second: '2-digit' }],
  compact: [{ day: '2-digit', month: '2-digit', year: '2-digit' }, { hour: '2-digit', minute: '2-digit' }],
};

const formats = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.Collator>();
function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.Collator>(id: string, create: () => T): T {
  let f = formats.get(id) as T | undefined;
  if (!f) formats.set(id, (f = create()));
  return f;
}

/** Local time in the current locale; date and time joined by a space (no locale-specific comma). */
export function formatDate(value: string | number | Date | null | undefined, style: DateStyle = 'minutes'): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const locale = currentLocale();
  const [dateOpts, timeOpts] = DATE_OPTIONS[style];
  const d = cached(`d:${locale}:${style}`, () => new Intl.DateTimeFormat(locale, dateOpts)) as Intl.DateTimeFormat;
  if (!timeOpts) return d.format(date);
  const time = cached(`t:${locale}:${style}`, () => new Intl.DateTimeFormat(locale, timeOpts)) as Intl.DateTimeFormat;
  return `${d.format(date)} ${time.format(date)}`;
}

export function formatNumber(value: number, fractionDigits = 0): string {
  const locale = currentLocale();
  const f = cached(
    `n:${locale}:${fractionDigits}`,
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }),
  ) as Intl.NumberFormat;
  return f.format(value);
}

/** Natural, case-insensitive sort order of the current locale ("Gerät 2" before "Gerät 10"). */
export function compareText(a: string, b: string): number {
  const locale = currentLocale();
  return (cached(`c:${locale}`, () => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })) as Intl.Collator).compare(a, b);
}
