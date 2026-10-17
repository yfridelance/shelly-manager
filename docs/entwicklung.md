# Entwicklung

Für alle, die am Shelly Manager weiterentwickeln. Die verbindlichen Regeln (Vertrag, Datenmodell, API,
Sicherheitsregeln, Shelly-API-Wissen) stehen in [CLAUDE.md](../CLAUDE.md); dieses Dokument erklärt den Aufbau und
die Arbeitsabläufe. Bedienung: [Benutzerhandbuch](benutzerhandbuch.md), Betrieb: [betrieb.md](betrieb.md).

## Setup

- **Node.js 24, mindestens 24.15** (Angular CLI 22) mit npm ≥ 11.19. Mit nvm: `nvm use` liest `.nvmrc`.
- **TypeScript 6.0** im ganzen Workspace (Angular 22 verlangt `>=6.0 <6.1`).
- npm ≥ 11.19 blockiert Install-Scripts. Freigegeben sind die nötigen Pakete in `allowScripts` der Root-`package.json`
  (u.a. `better-sqlite3`, `esbuild`). Neue native Pakete dort ergänzen (`npm install-scripts approve <paket>`).
- Alternativ `.devcontainer/` für VS Code Dev Containers.

```bash
npm install
npm run dev        # Server auf 3000 (tsx watch) + Angular auf 4200 (Proxy /api → 3000)
npm run dev:mock   # dazu die Mock-Fleet; im UI 10.99.0.0/24 scannen
npm run build      # apps/server/dist und apps/web/dist/web/browser
npm test           # Server (Vitest) und Web (Angular/Vitest)
npm run typecheck -w apps/server
```

Einzelne Server-Tests: `cd apps/server && npx vitest run test/templates/planner.test.ts -t "AP"`.

### Ohne echte Geräte

`npm run dev:mock` startet die Mock-Fleet aus `apps/server/test/mock-shelly/` auf den Ports 18001–18008
(Gen1 mit/ohne Passwort, Gen2/3/4 mit/ohne Passwort, ein hängender Host, ein fremder HTTP-Server). Der Server leitet
`10.99.0.0/24` per `SHELLY_HOST_MAP=10.99.0.0/24=127.0.0.1:18000` dorthin um (`10.99.0.N` → Port `18000+N`) und
nutzt eine eigene Datenbank unter `apps/server/data/mock`. Die Testpasswörter gibt das Mock-Skript beim Start aus.

## Projektstruktur

```
apps/
  server/                     Fastify 5, TypeScript, SQLite (better-sqlite3)
    migrations/               nummerierte SQL-Migrationen (laufen beim Start)
    src/
      main.ts, app.ts         Start, Fastify-Aufbau, Routen-Registrierung
      config.ts               Umgebungsvariablen
      security/host-guard.ts  Host-/Origin-Prüfung (DNS-Rebinding)
      shelly/                 Geräte-Protokolle
        detect.ts             GET /shelly → DeviceInfo (Gen-Erkennung)
        gen1-adapter.ts       REST + Basic Auth
        rpc-adapter.ts        JSON-RPC + Digest (Gen2/3/4), Script-Verteilung
        digest.ts             HTTP Digest (RFC 7616, SHA-256)
        firmware.ts           Update-Infos aus Status/OTA
        host-map.ts           SHELLY_HOST_MAP (Dev/Tests)
      scan/                   IP-Bereiche, Parallelität, Scan-Jobs (ScanManager)
      devices/device-service.ts  Aktionen pro Gerät: Snapshot, Reboot, Reset, Firmware, Template
      templates/              Settings-Schema und Planer (Settings → Gerätebefehle)
      db/                     Zugriff auf devices, config_snapshots, action_log, templates
      export/                 CSV/JSON-Export
      routes/                 HTTP-Routen mit TypeBox-Schemas
    test/                     Vitest; mock-shelly/ ist die Mock-Fleet
  web/                        Angular 22, Standalone Components, Signals, SCSS
    src/app/
      core/                   API-Typen, API-Clients, deutsche Texte, Template-Feldliste
      features/               scan, inventory, device, templates, log, sites
      shared/                 JSON-Baum, JSON-Diff, Inline-Edit
docs/                         diese Dokumentation (Bilder in docs/img)
scripts/docs-screenshots/     Screenshots der Doku neu erzeugen
.github/workflows/ci.yml      CI
```

## Architektur

### Server

- **Adapter-Schicht** (`src/shelly/`): `ShellyAdapter` mit `getInfo`, `getConfig`, `getStatus`, `reboot`,
  `factoryReset`, `checkForUpdate`, `startUpdate` und `applyConfig`. `createAdapter(host, gen)` wählt `Gen1Adapter` oder
  `RpcAdapter`. Fehler sind typisiert (`ShellyAuthError`, `ShellyTimeoutError`, `ShellyNetworkError`,
  `ShellyRpcError` …) und werden über `describeError` zu stabilen Codes, die das UI übersetzt.
- **Scan** (`src/scan/`): `ScanManager` führt einen Job zur Zeit aus (32 parallel, 1,5 s Timeout pro Host,
  abbrechbar), meldet Fortschritt per Server-Sent Events und schreibt per Upsert über die MAC. Zugangsdaten liegen
  nur als privates Feld im laufenden Job.
- **Geräteaktionen** (`DeviceService`): jede Aktion
  1. prüft per `/shelly`, dass unter der gespeicherten IP dieselbe MAC antwortet,
  2. läuft exklusiv pro Gerät,
  3. wird mit Ergebnis, Fehlercode und Details im `action_log` protokolliert.
  Reset und Template machen vorher einen Snapshot und blockieren, wenn dieser fehlschlägt.
- **Snapshots** (`src/db/snapshots.ts`): rohe Geräteantworten unverändert. Ein neuer Snapshot entsteht nur, wenn sich
  Info oder Config ändern; sonst wird der letzte mit `confirmed_at` und aktuellem Status bestätigt. Bei Gen1 werden
  dafür die Uhrzeit-Felder `time`/`unixtime` der Config ignoriert.
- **Templates** (`src/templates/`): Das Schema `TemplateSettings` beschreibt kuratierte Settings. Der Planer
  `planTemplate(gen, config, settings, ctx, secrets)` ist eine reine Funktion. Er erzeugt pro Feld einen Plan-Eintrag
  (`change`, `same`, `unsupported` mit Grund) und die nötigen Aufrufe: Gen1-`/settings`-Parameter oder Gen2+
  `<Komponente>.SetConfig`, je Komponente zusammengefasst. Gesetzt werden nur Felder, die die aktuelle Config kennt.
- **Standorte** (`src/db/sites.ts`, `src/routes/sites.ts`): `site_id` an Geräten, Templates und Protokolleinträgen.
  Listen-Endpunkte nehmen `?site=`, Scans und neue Templates `siteId`. IPs sind nur pro Standort eindeutig: alle
  IP-Prüfungen (`upsertSeenDevice`, `markMissing`, `updateDeviceIp`, IP-Planung) filtern nach Standort. Ein Scan
  liest und ändert keine Geräte anderer Standorte (`snapshot: 'foreign'`).
- **Sicherheit**: Host-Guard für alle `/api`-Routen. Ajv entfernt unbekannte Felder nicht, sondern lehnt sie ab
  (`additionalProperties: false` greift wirklich). Log-Redaction für Credentials. Gen1-Fehlermeldungen enthalten keinen
  Query-String, weil darin `mqtt_pass` stehen kann.

### Web

- Standalone Components mit Signals, `httpResource` für Lesezugriffe, Lazy Loading pro Ansicht,
  zoneless Change Detection, Locale `de-CH`.
- Alle UI-Texte deutsch; Fehlercodes vom Server werden in `core/texts.ts` übersetzt, Aktionstexte in
  `core/action-text.ts`, Template-Felder und Labels in `core/template-fields.ts`.
- Sammelabläufe («Alle auf Updates prüfen», Template anwenden) laufen im Browser mit begrenzter Parallelität über die
  Einzel-Endpunkte; so gibt es Fortschritt pro Gerät ohne Job-Verwaltung im Server.
- Passwörter liegen nur in Formular-Signals und werden beim Absenden geleert.

## Datenbank und Migrationen

- Neue Migration: nächste Nummer in `apps/server/migrations/` (`NNN_beschreibung.sql`). Sie läuft in einer Transaktion
  und wird in `schema_migrations` vermerkt. Bestehende Migrationen nie ändern.
- Spalten nur hinzufügen. Bei Bedarf bestehende Daten in derselben Migration nachführen (Beispiel: `007_device_id.sql`
  übernimmt Geräte-IDs aus Snapshots).
- Das aktuelle Schema steht in [CLAUDE.md, Abschnitt 7](../CLAUDE.md#7-datenmodell-sqlite).

## API

Alle Routen liegen unter `/api` und haben TypeBox-Schemas (Request und Response). Die vollständige Liste mit
Fehlercodes steht in [CLAUDE.md, Abschnitt 8](../CLAUDE.md#8-rest-api). Fehler haben die Form
`{ error: <code>, message, cause? }`: 400 Eingabe, 404 unbekannt, 409 Sicherheitsprüfung, 502 Gerätefehler,
403 Host/Origin.

## Tests

- **Server** (`apps/server/test/`, Vitest): Unit-Tests (Digest mit RFC-7616-Vektoren, IP-Bereiche, Planer, Diff …) und
  API-Tests über `app.inject` gegen die Mock-Fleet. Typisches Muster: Mock-Geräte starten, per `hostFor` auf
  `10.0.0.N` abbilden, Gerät ins Inventar schreiben, Endpunkt aufrufen, Zustand im Mock (`state.requests`,
  `rebootCount`, `secretsReceived` …) und in der DB prüfen.
- **Mock-Fleet** (`test/mock-shelly/`): ein HTTP-Server pro Gerät; eigene Digest-Prüfung, unabhängig vom
  Client-Code. Optionen: `failing`, `dropConnectionOnReset`, `offlineAfterReset`, `updates`, `delayMs`, sowie
  `hang`- und `foreign`-Hosts. Configs sind beschreibbar und **strikt**: unbekannte Parameter ergeben einen Fehler.
  Der Mock verhält sich wie Firmware 2.x (z.B. AP nur mit Passwort einschalten).
- **Web** (`*.spec.ts`, Angular-Builder mit Vitest/jsdom): Komponenten mit `HttpTestingController`. Hinweis:
  `fixture.whenStable()` wartet auch auf offene HTTP-Requests; Hintergrund-Requests deshalb zuerst beantworten.
  Effekte lassen sich mit `TestBed.tick()` anstossen.
- **Pflicht**: Die Sicherheitsregeln aus CLAUDE.md Abschnitt 9 sind durch Tests belegt
  (`test/devices/actions-api.test.ts`, `test/host-guard.test.ts`, Passwort-Tests in Scan-, Template- und Aktions-Tests).
  Änderungen an diesen Abläufen brauchen passende Tests.

## CI

`.github/workflows/ci.yml` läuft bei Push auf `master` und bei Pull Requests:

- `test`: Node gemäss `.nvmrc` (neustes 24.x), `npm ci`, Prüfung des nativen SQLite-Moduls,
  `npm run typecheck -w apps/server`, `npm run build`, `npm test`.
- `docker`: Image-Build aus dem `Dockerfile` (ohne Push, mit GitHub-Actions-Cache).

## Screenshots der Doku

Die Bilder in `docs/img/` entstehen automatisch aus der Mock-Fleet:

```bash
npm run build
./scripts/docs-screenshots/run.sh
```

Das Skript startet Mock-Fleet und einen Server auf Port 3100 mit einer temporären Datenbank (`setup.sh` legt
Beispieldaten an: Scans, Namen, Orte, ein Template, ein Netzwerk-Template nur zur Vorschau, ein zweiter Standort). Dann steuert es Chrome im Headless-Modus über das
DevTools-Protokoll (`shots.mjs`, ohne zusätzliche Abhängigkeiten) und speichert die Bilder in 1280 px Breite.
Voraussetzungen: Google Chrome (anderer Pfad über `CHROME=…`) sowie freie Ports 3100 und 28001–28008 (eigene Mock-Fleet über `MOCK_BASE_PORT`, ein laufendes `npm run dev:mock` bleibt unberührt).
Echte Geräte und `apps/server/data` werden nicht berührt. Nach UI-Änderungen das Skript erneut laufen lassen und die
Bilder mitcommitten.

## Häufige Erweiterungen

**Neue Template-Einstellung**

1. Feld im Schema `apps/server/src/templates/settings.ts` ergänzen.
2. Mapping in `FIELDS` in `apps/server/src/templates/planner.ts`: Ziel aus den Settings, `gen1` (Lesen aus
   `/settings`, Parameter für den Schreibaufruf) und/oder `rpc` (Lesen aus `GetConfig`, partielle Config für
   `SetConfig`). Parameternamen gegen die offizielle Doku prüfen.
3. Mock nachziehen (Gen1: `SETTINGS_PARAMS` in `test/mock-shelly/gen1.ts`; Gen2+: Feld in der Basis-Config von
   `test/mock-shelly/rpc.ts`). Der strikte Mock meldet sonst einen Fehler.
4. Tests im Planer und in `test/templates/templates-api.test.ts`.
5. UI: Feld in `apps/web/src/app/core/template-fields.ts` (gleicher Key wie im Planer), Typ in `core/api.types.ts`.
6. Tabelle in CLAUDE.md Abschnitt 14 und im [Benutzerhandbuch](benutzerhandbuch.md#7-templates) ergänzen.

**Neue Geräteaktion**

Methode im `DeviceService` mit `exclusive` und `logged` (MAC-Prüfung über `connect`), Aktionstyp in
`src/db/actions.ts`, Route in `src/routes/devices.ts`, Text in `apps/web/src/app/core/texts.ts` (`ACTION_TEXT`) und
gegebenenfalls in `core/action-text.ts`.

## Konventionen

- Code und Bezeichner Englisch, UI-Texte Deutsch in Schweizer Schreibweise (kein ß).
- TypeScript strict, keine `any` ohne Kommentar.
- Rohe Geräteantworten unverändert speichern, Normalisierung nur in eigenen Feldern.
- Bei unklarem Shelly-Verhalten die offizielle Doku (shelly-api-docs.shelly.cloud) prüfen und die Annahme im Code
  kommentieren. Die API-Doku ist nicht immer aktuell (Beispiel: AP-Passwort seit Firmware 2.0, nur im Changelog),
  deshalb Funde von echten Geräten in Mock und Tests übernehmen.
- Kleine, nachvollziehbare Commits.
