import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import de from '../../../locale/de.json';
import { toDeviceApiError } from '../devices-api';
import { errorText } from '../texts';
import { activateLanguage, addTranslations, compareText, flatten, formatDate, formatNumber, t, translate } from './i18n';
import { I18N_LANGUAGES, I18nService, detectLanguage } from './i18n.service';
import { LANGUAGES, type Language } from './languages';
import { EmphasisPipe } from './pipes';

const PLURAL = /_(zero|one|two|few|many|other)$/;
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => activateLanguage('de', 'de-CH'));

  it('interpolates, picks plural forms and falls back to German, then to the key', () => {
    expect(t('scan.found', { count: 1 })).toBe('Shelly gefunden');
    expect(t('scan.found', { count: 3 })).toBe('Shellys gefunden');
    expect(t('scan.checked', { scanned: 5, total: 254 })).toBe('5 von 254 Adressen geprüft');

    addTranslations('xx', { scan: { title: 'Network scan' } });
    activateLanguage('xx', 'en-GB');
    expect(t('scan.title')).toBe('Network scan');
    expect(t('scan.start')).toBe('Scan starten');
    expect(translate('no.such.key')).toBe('no.such.key');
  });

  it('formats dates, numbers and sorting with the current locale', () => {
    const iso = new Date(2026, 9, 14, 9, 5, 7).toISOString();
    expect(formatDate(iso, 'seconds')).toBe('14.10.2026 09:05:07');
    expect(formatDate(iso, 'compact')).toBe('14.10.26 09:05');
    expect(formatDate(null)).toBe('');
    expect(formatNumber(1.5, 1)).toBe('1.5');
    expect(['Gerät 10', 'gerät 2', 'Ärger'].sort(compareText)).toEqual(['Ärger', 'gerät 2', 'Gerät 10']);

    activateLanguage('de', 'de-DE');
    expect(formatNumber(1.5, 1)).toBe('1,5');
  });

  it('translates error codes and never shows the server message', () => {
    expect(errorText('busy')).toBe('Auf diesem Gerät läuft bereits eine Aktion');
    expect(errorText('something_new')).toBe('Fehler (something_new)');
    const err = toDeviceApiError(
      new HttpErrorResponse({ status: 409, error: { error: 'site_not_empty', message: 'Der Standort enthält noch Geräte …' } }),
    );
    expect(err.code).toBe('site_not_empty');
    expect(err.message).toBe(t('errors.site_not_empty'));
    // Fastify's validation errors have no code of ours.
    const validation = toDeviceApiError(new HttpErrorResponse({ status: 400, error: { error: 'Bad Request', message: 'body/x must be string' } }));
    expect(validation.message).toBe('Ungültige Eingabe.');
  });

  it('escapes translations and only turns **text** into <strong>', () => {
    expect(new EmphasisPipe().transform('Im **AP-Modus** <b>x</b>')).toBe('Im <strong>AP-Modus</strong> &#60;b&#62;x&#60;/b&#62;');
  });

  it('detects the language: remembered, then browser, then German', () => {
    const langs: Language[] = [
      { code: 'de', locale: 'de-CH', name: 'Deutsch', load: async () => ({}) },
      { code: 'fr', locale: 'fr-CH', name: 'Français', load: async () => ({}) },
    ];
    expect(detectLanguage(langs, 'fr', ['de-CH'])).toBe('fr');
    expect(detectLanguage(langs, 'xx', ['en-US', 'fr-FR'])).toBe('fr');
    expect(detectLanguage(langs, null, ['en-US'])).toBe('de');
  });

  it('switches the language at runtime, sets <html lang> and remembers the choice', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: I18N_LANGUAGES,
          useValue: [
            LANGUAGES[0],
            { code: 'en', locale: 'en-GB', name: 'English', load: async () => ({ nav: { scan: 'Scan', inventory: 'Inventory' } }) },
          ] satisfies Language[],
        },
      ],
    });
    const i18n = TestBed.inject(I18nService);
    await i18n.use('en');
    expect(t('nav.inventory')).toBe('Inventory');
    expect(document.documentElement.lang).toBe('en-GB');
    expect(localStorage.getItem('shelly-manager.lang')).toBe('en');

    await i18n.init();
    expect(i18n.language()).toBe('en');
    await i18n.use('de');
    expect(t('nav.inventory')).toBe('Inventar');
    expect(document.documentElement.lang).toBe('de-CH');
    localStorage.removeItem('shelly-manager.lang');
  });

  // Translators only edit the locale files: catch typos in keys and placeholders.
  it('every language file uses only keys and placeholders of de.json', async () => {
    const source = flatten(de);
    const bases = new Set([...source.keys()].map((k) => k.replace(PLURAL, '')));
    for (const lang of LANGUAGES) {
      const dict = flatten(await lang.load());
      for (const [key, text] of dict) {
        const base = key.replace(PLURAL, '');
        expect(bases.has(base), `${lang.code}: unknown key ${key}`).toBe(true);
        const original = source.get(key) ?? source.get(`${base}_other`) ?? source.get(base) ?? '';
        expect(placeholders(text), `${lang.code}: placeholders of ${key}`).toEqual(
          // `count` may be dropped in a plural form ("one item" instead of "1 item").
          placeholders(original).filter((p) => placeholders(text).includes(p) || p !== 'count'),
        );
      }
    }
  });
});
