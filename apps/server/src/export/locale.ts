import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Texts for exports come from the web UI's locale files, so translators edit one file per language.
 * Resolves to apps/web/src/locale from both src/export (tsx) and dist/export (build); the Dockerfile
 * copies the folder.
 */
export const LOCALE_DIR = fileURLToPath(new URL('../../../web/src/locale/', import.meta.url));

export const DEFAULT_LANG = 'de';

/** Looks up a text by key ("export.csv.name"), with `{{name}}` placeholders. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

const cache = new Map<string, Map<string, string> | null>();

function flatten(obj: object, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out.set(prefix + k, v);
    else if (v && typeof v === 'object') flatten(v as object, `${prefix}${k}.`, out);
  }
  return out;
}

function load(dir: string, lang: string): Map<string, string> | null {
  const id = `${dir}\0${lang}`;
  if (!cache.has(id)) {
    try {
      cache.set(id, flatten(JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8')) as object));
    } catch {
      cache.set(id, null);
    }
  }
  return cache.get(id) ?? null;
}

/**
 * Translator for a language code from the request; unknown or missing languages and keys fall back
 * to German, then to the key. The code is checked against a pattern before it becomes a file name.
 */
export function translator(lang: string | undefined, dir = LOCALE_DIR): Translate {
  const code = lang && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang) ? lang : DEFAULT_LANG;
  const dicts = [load(dir, code), load(dir, code.split('-')[0] ?? DEFAULT_LANG), load(dir, DEFAULT_LANG)];
  return (key, params) => {
    const text = dicts.reduce<string | undefined>((found, d) => found ?? d?.get(key), undefined) ?? key;
    return params ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
  };
}
