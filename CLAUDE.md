# AGENTS.md – Shelly Manager

Briefing für Coding-Agents. Lies dieses Dokument vollständig, bevor du Code schreibst.

Die Dokumentation für Menschen liegt in `docs/` ([Benutzerhandbuch](docs/benutzerhandbuch.md), [Betrieb](docs/betrieb.md), [Entwicklung](docs/entwicklung.md)). Wer Verhalten, Bedienung, Konfiguration oder Betrieb ändert, führt die betroffenen Dokumente im selben Commit nach.

## 1. Ziel

Eine selbst gehostete Web-App, die Shelly-Geräte (Gen1 bis Gen4) in einem Netzwerk findet, inventarisiert und verwaltet.

**Konkreter Anlass (MVP):** Ein Haus wird verkauft. Mehrere Dutzend Shellys müssen erfasst, dokumentiert und anschliessend **einzeln** auf Werkseinstellungen zurückgesetzt werden. Die App läuft dafür auf einem Laptop im Haus-WLAN.

**Langfristig:** Inventar über mehrere Standorte, Standort und Notizen pro Gerät, Settings auf mehrere Geräte gleichzeitig anwenden, Config-Historie und Drift-Erkennung.

## 2. Scope

### MVP (jetzt umsetzen)
1. Netzwerk-Scan über einen IP-Bereich (CIDR oder Start/End-IP), den der Benutzer in der GUI eingibt
2. Erkennung von Generation, Modell, MAC, Firmware und Name pro Gerät
3. Inventar-Tabelle mit Filter und Sortierung
4. Detailansicht: Geräteinfos, aktuelle Config (JSON, lesbar dargestellt), Standort und Notizen bearbeitbar
5. Config-Snapshot pro Gerät speichern (bei jedem Scan bzw. auf Knopfdruck)
6. Export des Inventars als JSON (inkl. Configs) und CSV (Übersicht)
7. Reboot pro Gerät
8. Factory Reset **pro Gerät** mit Bestätigungsdialog
9. Aktionsprotokoll: wer/was/wann/Ergebnis

### Über das MVP hinaus umgesetzt
- Firmware-Updates pro Gerät: Verfügbarkeit aus dem Status (bei jedem Scan/Snapshot), explizit prüfen, Stable/Beta installieren
- Config-Vergleich zweier Snapshots eines Geräts (erster Schritt Richtung Drift-Erkennung)
- Stockwerk, Namensvorschlag aus Stockwerk/Ort/Typ und Namen aufs Gerät schreiben (einzeln oder per Template-Feld `device.name`)
- Templates: kuratierte Settings (MQTT, Cloud, Gerätename, Zeit/Koordinaten, Eco/LED, Bluetooth inkl. BLE-RPC, WLAN-AP, AP-Roaming, CoIoT, Script, Netzwerk mit fortlaufender statischer IP) mit Vorschau pro Gerät und Anwenden auf mehrere Geräte (siehe Abschnitt 14)
- Standorte (Mandanten ohne Login): getrennte Inventare, Templates und Protokolle; Auswahl im UI (siehe Abschnitt 15)

### Nicht im MVP (Datenmodell aber vorbereiten)
- Drift-Erkennung über mehrere Geräte (Template als Soll-Zustand ist mit der Vorschau schon fast da)
- Verteilte Agents/Collectors pro Standort
- Benutzerverwaltung / Login (App läuft lokal bzw. hinter Reverse Proxy)
- Persistente Speicherung von Gerätepasswörtern
- mDNS/CoIoT-Discovery
- Shelly Cloud, BLU-Geräte

## 3. Technologie-Stack (fix)

| Bereich | Wahl |
|---|---|
| Runtime | Node.js 24 LTS (mindestens 24.15, wegen Angular CLI 22; `.nvmrc`), TypeScript 6.0 strict (Angular 22 verlangt `>=6.0 <6.1`) |
| Backend | Fastify, `@fastify/static`, Schemas mit TypeBox (`@fastify/type-provider-typebox`) |
| DB | SQLite über `better-sqlite3`, SQL-Migrationen als nummerierte Dateien |
| Frontend | Angular 22, Standalone Components, Signals, SCSS; UI-Komponenten aus `@yfridelance/kern` (eigene Web Components) |
| Monorepo | npm Workspaces (`apps/server`, `apps/web`) |
| Tests | Vitest (Server), Angular-Standard für Web |
| Container | `Dockerfile` (mehrstufig, `node:24-bookworm-slim`), `docker-compose.yml`, `.devcontainer/` |

Keine weiteren schweren Abhängigkeiten ohne Begründung. Für HTTP zu den Geräten reicht das native `fetch` von Node; Digest Auth selbst implementieren (kleines, getestetes Modul).

## 4. Build-, Dev- und Container-Vertrag

Diese Punkte definieren einen Vertrag. **Nicht brechen**, oder Dockerfile und [docs/betrieb.md](docs/betrieb.md) im selben Schritt anpassen:

| Punkt | Erwartung |
|---|---|
| Server-Build | `npm run build -w apps/server` → `apps/server/dist/main.js` (ESM, `"type": "module"`) |
| Web-Build | `npm run build -w apps/web` → `apps/web/dist/web/browser` |
| Root-Build | `npm run build` baut beide; `npm test` testet beide |
| Dev | `npm run dev` startet Server (tsx watch, fest Port 3000) und Angular (fest Port 4200). Einzeln: `npm run dev -w apps/server`, `npm run start -w apps/web` |
| Dev ohne Geräte | `npm run dev:mock`: zusätzlich Mock-Fleet auf Ports 18001–18008, Bereich `10.99.0.0/24` per `SHELLY_HOST_MAP` umgeleitet, eigene DB unter `apps/server/data/mock` |
| Env | `PORT` (Dev 3000, Container 8080), `HOST` (Default `127.0.0.1`, Container `0.0.0.0`), `DATA_DIR` (SQLite-Ablage), `STATIC_DIR` (nur Produktion: Angular-Bundle ausliefern), `LOG_LEVEL`, `SHELLY_HOST_MAP` (nur Dev/Tests: IPs auf Mock-Geräte umleiten), `ALLOWED_HOSTS` (zusätzliche erlaubte Hostnamen für die API, kommagetrennt, z.B. Reverse Proxy) |
| Health | `GET /api/health` → 200 `{ status: "ok" }` |
| Dev-Proxy | Angular leitet `/api` auf `http://localhost:3000` weiter (`proxy.conf.json`), SSE inklusive |
| Migrationen | Nummerierte SQL-Dateien in `apps/server/migrations/` (neben `src`/`dist`), laufen beim Start automatisch; das Dockerfile kopiert den Ordner mit |
| Übersetzungen | `apps/web/src/locale/<code>.json`; der Server liest daraus die CSV-Texte (Pfad relativ zu `src`/`dist`), das Dockerfile kopiert den Ordner ins Image |
| Container | `docker compose up -d --build` → App unter `http://localhost:8080`; Port nur auf `127.0.0.1` gebunden (kein Login); Daten im Volume `shelly-data` (`/data`); läuft als Benutzer `node` mit Healthcheck |
| Image | CI (`.github/workflows/ci.yml`) pusht nach grünen Tests `ghcr.io/yfridelance/shelly-manager` für `linux/amd64` und `linux/arm64` (`latest`/`master`/`sha-…` von `master`, Semver von `v*`-Tags); Build-Stage im Dockerfile auf `$BUILDPLATFORM`, nur `prod-deps` pro Zielarchitektur |
| npm | npm ≥ 11.19 blockiert Install-Scripts; native Pakete sind in `allowScripts` der Root-`package.json` freigegeben |

Alle API-Routen liegen unter `/api`. In Produktion liefert Fastify das SPA aus, mit Fallback auf `index.html` für unbekannte Nicht-API-Pfade.

## 5. Shelly-API-Wissen

Es gibt faktisch **zwei Protokolle**. Gen3 und Gen4 sprechen dieselbe API wie Gen2.

### Erkennung
`GET http://<ip>/shelly` ist auf allen Generationen **ohne Auth** erreichbar.
- Antwort enthält Feld `gen` (2, 3, 4) → RPC-Gerät. Relevante Felder: `id`, `mac`, `model`, `gen`, `fw_id`, `ver`, `app`, `auth_en`.
- Kein Feld `gen` → Gen1. Relevante Felder: `type`, `mac`, `auth`, `fw`.

MAC normalisieren (Grossbuchstaben, ohne Trennzeichen). **Die MAC ist der Primärschlüssel**, nie die IP.

Gerätename: Gen1 liefert ihn nur über `/settings` (bei geschützten Geräten also nur mit Zugangsdaten). Gen2+ liefert ihn in `/shelly` erst ab neuerer Firmware, sonst über `Sys.GetConfig` → `device.name`.

### Gen1 (REST)
- Auth: HTTP Basic (unverschlüsselt über HTTP); Fehlerantworten sind 4xx mit `text/plain`
- `GET /settings` – Config
- `GET /status` – Status (enthält `update: { has_update, new_version, beta_version }`)
- `GET /reboot` – Neustart
- `GET /ota/check` – neue Update-Prüfung anstossen (asynchron), `GET /ota` – Update-Info, `GET /ota?update=true` bzw. `?beta=true` – Update starten
- `GET /settings?reset=true` – Factory Reset (laut offizieller Gen1-Doku: Parameter `reset` auf `/settings`, „Will perform a factory reset of the device". Einen Endpoint `/reset` gibt es nicht.)

### Gen2+ (JSON-RPC 2.0)
- Endpoint `POST /rpc` mit `{ "id": 1, "method": "...", "params": {...} }`
- Auth: HTTP Digest, Algorithmus SHA-256, Realm = Geräte-ID; Benutzer ist immer `admin`
- `Shelly.GetDeviceInfo`, `Shelly.GetConfig`, `Shelly.GetStatus`
- `Shelly.Reboot`, `Shelly.FactoryReset`, `Sys.GetConfig`
- `Shelly.CheckForUpdate` (`{ stable?: { version, build_id }, beta?: … }`, leeres Objekt = kein Update), `Shelly.Update` (`{ stage: "stable" | "beta" }`)
- Status: `sys.available_updates` enthält dieselbe Info ohne Zusatzanfrage
- Digest-Details: Nonce wiederverwenden mit strikt steigendem `nc` (ab FW 2.0 Pflicht); bei `stale=true` einmal neu versuchen; bei falschem Passwort nicht wiederholen (Geräte drosseln nach vielen Fehlversuchen bis zu 5 Minuten)

Referenz: offizielle Shelly-API-Dokumentation (shelly-api-docs.shelly.cloud). Bei Unsicherheiten dort nachsehen, nicht raten.

### Adapter-Interface
```ts
interface ShellyAdapter {
  getInfo(): Promise<DeviceInfo>;
  getConfig(): Promise<unknown>;   // rohes JSON, unverändert speichern
  getStatus(): Promise<unknown>;
  reboot(): Promise<void>;
  factoryReset(): Promise<void>;
  checkForUpdate(): Promise<FirmwareUpdates>;   // { stable, beta }: Gen1 Firmware-ID, Gen2+ Version
  startUpdate(channel: 'stable' | 'beta'): Promise<void>;
}
```
Implementierungen: `Gen1Adapter`, `RpcAdapter`. Auswahl über das Ergebnis von `/shelly`.

## 6. Scan-Verhalten

- Eingabe: CIDR (z.B. `192.168.1.0/24`) oder Bereich. Maximal 1024 Adressen pro Scan.
- Parallelität begrenzt (Default 32), Timeout pro Host ca. 1500 ms.
- Fortschritt an das Frontend melden (Server-Sent Events oder Polling eines Scan-Jobs).
- Ein Scan ist ein Job mit ID und Status (`running`, `done`, `failed`, `cancelled`), abbrechbar.
- Gefundene Geräte: per Upsert über MAC; IP, Firmware und `last_seen` aktualisieren. Standort und Notizen bleiben unangetastet.
- Geschützte Geräte (`auth`/`auth_en`): als `auth_required` markieren. Config nur lesen, wenn der Benutzer Zugangsdaten eingegeben hat.
- Zugangsdaten werden **nur im Speicher** gehalten (pro Scan oder Sitzung), nie in der DB oder in Logs.

Hinweis: Im Container sieht die App nur ihr internes Netz. Keine automatische Subnetz-Erkennung bauen; der Benutzer gibt den Bereich an.

## 7. Datenmodell (SQLite)

Stand nach Migration 012 (`apps/server/migrations/`, Buchführung in `schema_migrations`):

```sql
devices (
  mac TEXT PRIMARY KEY,
  ip TEXT,                       -- letzte bekannte IP; übernimmt ein anderes Gerät die IP, wird sie hier geleert
  gen INTEGER NOT NULL,          -- 1, 2, 3, 4
  model TEXT,                    -- Gen1: type, Gen2+: model
  app TEXT,                      -- Gen2+: app
  firmware TEXT,                 -- Gen1: fw, Gen2+: fw_id
  name TEXT,                     -- lokaler Anzeigename (PATCH); folgt device_name, solange nicht lokal geändert
  device_name TEXT,              -- Name, den das Gerät meldet
  site_id INTEGER NOT NULL DEFAULT 1, -- Standort (sites.id), App hält die Referenz gültig
  device_id TEXT,                -- Shelly-ID: Gen2+ `id` aus /shelly, Gen1 Hostname aus /settings (bei geschützten Gen1 erst mit Passwort); bleibt erhalten, wenn ein Scan sie nicht lesen kann
  auth_required INTEGER NOT NULL DEFAULT 0,
  floor TEXT,                    -- «Stockwerk» (lokal, frei); Gebäude-Reihenfolge in src/devices/floor.ts (Kopie in apps/web/src/app/core/floor.ts)
  location TEXT,
  notes TEXT,
  kind TEXT,                     -- «Typ»: was angeschlossen ist (lokal, frei)
  functions TEXT,                -- JSON DeviceFunctions, abgeleitet aus dem neusten Snapshot (src/devices/functions.ts)
  state TEXT NOT NULL DEFAULT 'active', -- active | reset | missing
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  update_stable TEXT,            -- angebotenes Firmware-Update (Gen1: ID, Gen2+: Version)
  update_beta TEXT,
  update_checked_at TEXT
)

config_snapshots (
  id INTEGER PRIMARY KEY,
  mac TEXT NOT NULL REFERENCES devices(mac),
  taken_at TEXT NOT NULL,
  info_json TEXT NOT NULL,
  config_json TEXT,
  status_json TEXT,
  confirmed_at TEXT              -- zuletzt mit identischer Info/Config gesehen (NULL = nur einmal)
)

action_log (
  id INTEGER PRIMARY KEY,
  mac TEXT NOT NULL,             -- bewusst ohne FK
  action TEXT NOT NULL,          -- snapshot | reboot | factory_reset | firmware_update | rename
  requested_at TEXT NOT NULL,
  requested_by TEXT,             -- Client-Adresse (es gibt keine Benutzer)
  finished_at TEXT,
  result TEXT,                   -- ok | error
  error_code TEXT,               -- stabiler Code, das UI zeigt deutschen Text
  error TEXT,                    -- technische Meldung (Englisch)
  details TEXT                   -- JSON, z.B. { snapshotId }, { snapshotSkipped }, { confirmed: false }, { channel, from, to }, rename: { from, to, snapshotAfterId }
)
```

templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  settings_json TEXT NOT NULL,   -- TemplateSettings (apps/server/src/templates/settings.ts), nie Secrets
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

`action_log.action` kennt zusätzlich `apply_template` (details: templateId/-Name, snapshotId, snapshotAfterId, changes, unsupported, restartRequired, rebooted, script, bei Fehlern appliedSteps).

Snapshots werden nur bei Änderung neu angelegt (`insertSnapshot`, `src/db/snapshots.ts`): Sind `info_json` und `config_json` gleich wie beim neusten Snapshot des Geräts, werden in dieser Zeile nur `status_json` und `confirmed_at` aktualisiert, und ihre ID wird zurückgegeben (bleibt als «vorher gesichert» korrekt). Gen1-Configs werden ohne die Geräteuhr (`time`, `unixtime` in `/settings`) verglichen, gespeichert wird roh. Die Migrationen 008/009 haben ältere Duplikate zusammengefasst (ältestes `taken_at` bleibt, `confirmed_at`/`status_json` vom jüngsten); Zeilen, die in `action_log.details` (`snapshotId`, `snapshotAfterId`) referenziert sind, werden nie gelöscht.

`functions` setzt `insertSnapshot` bei jeder gelesenen Config neu (Gen aus `devices.gen`; Gen1: `relays`/`rollers` je nach `mode`, `lights`, `emeters`, Messung nur mit `meters[].total`; Gen2+: Komponenten `switch`/`cover`/`light`/`em`/`em1`/`pm1`/`input`/Sensoren, Messung über `apower` im Status). Ohne Config bleibt der alte Wert; `openDatabase` füllt fehlende Werte aus dem neusten Snapshot nach.

`missing`: Ein abgeschlossener Scan markiert aktive Geräte, deren IP im Bereich lag, die aber nicht mehr antworteten. Wird ein Gerät wieder gefunden, ist es wieder `active`.
Zeitstempel als ISO 8601 UTC. Geräte nie löschen, wenn sie zurückgesetzt wurden: `state = 'reset'` setzen, damit die Dokumentation erhalten bleibt.

`sites (id, name UNIQUE, description, created_at)`; `templates.site_id` (Namen eindeutig pro Standort), `action_log.site_id` (Standort zum Zeitpunkt der Aktion). Ohne `REFERENCES` angelegt (SQLite erlaubt bei ADD COLUMN mit Default ≠ NULL keine FK); ein Standort lässt sich nur löschen, wenn er leer ist, der letzte nie.

## 8. REST-API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Health |
| POST | `/api/scans` | Scan starten (`{ range, credentials? }`); 409, wenn schon einer läuft |
| GET | `/api/scans` | Letzte Scans (im Speicher) |
| GET | `/api/scans/:id` | Status/Fortschritt inkl. Treffer |
| GET | `/api/scans/:id/events` | SSE: `snapshot`, `progress`, `device`, `finished` |
| DELETE | `/api/scans/:id` | Scan abbrechen |
| GET | `/api/devices` | Liste |
| GET | `/api/devices/:mac` | Details inkl. neustem Snapshot und Snapshot-Liste |
| GET | `/api/devices/:mac/snapshots/:id` | Einzelner Snapshot |
| PATCH | `/api/devices/:mac` | `floor`, `location`, `notes`, `kind`, `name` (nur lokal, nicht aufs Gerät; leerer Name = Gerätename) |
| POST | `/api/devices/:mac/name` | Namen aufs Gerät schreiben (`{ name, credentials? }`; Gen1 ≤ 30, Gen2+ ≤ 64 Zeichen, sonst 400 `invalid_name`); danach `name = device_name`, Snapshot; Antwort `{ name, snapshotId }` |
| POST | `/api/devices/:mac/snapshot` | Config neu einlesen (`{ credentials? }`) |
| POST | `/api/devices/:mac/reboot` | Neustart |
| POST | `/api/devices/:mac/factory-reset` | Reset, Body `{ confirmMac, credentials?, allowWithoutSnapshot? }`; Antwort `{ snapshotId, confirmed }` |
| POST | `/api/devices/:mac/firmware/check` | Update-Prüfung (nicht protokolliert) |
| POST | `/api/devices/:mac/firmware/update` | Update starten (`{ channel, credentials? }`); 409 `no_update` |
| GET/POST | `/api/templates` | Templates auflisten / anlegen (`{ name, description?, settings }`) |
| GET/PUT/DELETE | `/api/templates/:id` | Template lesen / ändern / löschen |
| POST | `/api/templates/:id/preview` | Vorschau pro Gerät (`{ macs? }`, Default alle aktiven) aus dem neusten Snapshot, ohne Gerätezugriff; mit geplanten statischen IPs (`assignedIps`) für genau diese Auswahl |
| POST | `/api/devices/:mac/apply-template` | Template anwenden (`{ templateId, credentials?, secrets?: { mqttPassword?, apPassword? }, rebootIfRequired?, network?: { sta?, sta1? } }`; Antwort u.a. `network: { ip, confirmed }`) |
| GET | `/api/export.json` / `/api/export.csv` | Export (`?snapshots=all` für alle Snapshots; CSV: `?lang=` für Spaltentitel und Texte, Default/Fallback Deutsch) |
| GET | `/api/actions` | Aktionsprotokoll (`?mac=`, `?site=`, `?limit=`) |
| GET/POST | `/api/sites` | Standorte auflisten (mit Anzahl Geräte/Templates) / anlegen |
| GET/PUT/DELETE | `/api/sites/:id` | lesen / umbenennen / löschen (nur leer; 409 `site_not_empty`, `last_site`) |

`?site=` filtert `/api/devices`, `/api/scans`, `/api/templates`, `/api/actions`, `/api/export.*` (ohne = alle). `POST /api/scans` und `POST /api/templates` nehmen `siteId` (Default 1); `PATCH /api/devices/:mac { siteId }` verschiebt ein Gerät; `apply-template` verlangt gleichen Standort (409 `site_mismatch`).

Fehlercodes Templates: 409 `name_taken`, 400 `empty_template`, 400 `invalid_network`, 409 `ip_conflict`, 404 `template_not_found`, 409 `snapshot_failed` (vorher), 502 `template_failed` (mit `cause`).

MACs in URLs dürfen Trennzeichen und Kleinbuchstaben enthalten. Fehler kommen als `{ error: <code>, message, cause? }`: 400 Eingabe/`confirm_mismatch`/`invalid_name`, 403 `host_not_allowed`/`origin_not_allowed` (Abschnitt 9), 404 unbekannt, 409 Sicherheitsprüfung (`mac_mismatch`, `busy`, `snapshot_failed`, `no_ip`, `no_update`), 502 Gerätefehler (`auth_required`, `auth_invalid`, `timeout`, `network`, `http`, `rpc`). Unbekannte Felder im Body werden abgelehnt.

## 9. Sicherheitsregeln (nicht verhandelbar)

- **Kein Bulk-Factory-Reset.** Reset nur pro Gerät, im UI mit Dialog, in dem die MAC oder der Gerätename eingetippt werden muss. Das Backend prüft `confirmMac` zusätzlich.
- Vor jedem Reset automatisch einen Config-Snapshot erstellen. Schlägt der Snapshot fehl, Reset blockieren (mit expliziter Override-Option im Dialog).
- Im Dialog darauf hinweisen: Nach dem Reset startet das Gerät im AP-Modus und ist aus dem Netz verschwunden.
- Passwörter nie loggen, nie persistieren, nie im Frontend-State länger als nötig halten.
- Fehler pro Gerät sauber zurückmelden; ein Fehler bei einem Gerät darf keinen Scan abbrechen.

Zusätzlich umgesetzt (beibehalten):
- Vor jeder Geräteaktion per `/shelly` prüfen, dass unter der gespeicherten IP dieselbe MAC antwortet (sonst 409 `mac_mismatch`).
- Pro Gerät nur eine Aktion gleichzeitig (409 `busy`).
- Schutz gegen DNS-Rebinding/Cross-Site (`apps/server/src/security/host-guard.ts`): Alle `/api`-Anfragen brauchen einen erlaubten Host-Header (`localhost`, `*.localhost`, `127.0.0.1`, `::1` plus `ALLOWED_HOSTS`), sonst 403 `host_not_allowed`. Schreibende Anfragen (POST/PUT/PATCH/DELETE) mit `Origin`-Header brauchen einen erlaubten Origin-Host, sonst 403 `origin_not_allowed`. Das SPA selbst wird ohne Prüfung ausgeliefert.
- Bricht beim Reset die Verbindung ab, wird nach kurzer Wartezeit erneut geprüft: Gerät weg oder Passwortschutz entfernt → Reset gilt als unbestätigt erfolgreich (`confirmed: false`), sonst Fehler.
- Zugangsdaten gehen nur an Geräte, die sie verlangen. Für zurückgesetzte Geräte bietet das UI keine Aktionen mehr an.
- Netzwerk-Templates: geplante IP vorher prüfen (Netz, Inventar, antwortet niemand), Netzwerkänderung zuletzt, Gerät danach unter der neuen IP mit MAC-Prüfung wiederfinden; SSID/WLAN-Passwort nie anfassen.
- Templates: Anwenden nur nach Vorschau und einer Bestätigung; pro Gerät Snapshot vorher (blockiert bei Fehler) und nachher; MQTT- und AP-Passwort nur beim Anwenden, nie im Template, nie im Protokoll (maskiert); WLAN-Client-Einstellungen und Gerätepasswort sind bewusst nicht Teil von Templates.

## 10. Frontend

Ansichten:
1. **Scan:** IP-Bereich, optionale Zugangsdaten, Start/Abbruch, Fortschritt, Liste der Treffer
2. **Inventar:** Tabelle (Name, Geräte-ID, Modell, Gen, IP, MAC, Firmware, Typ/Funktion, Ort als «Stockwerk · Ort» sortiert in Gebäude-Reihenfolge, Status, zuletzt gesehen) des gewählten Standorts, Filter nach Gen/Stockwerk/Ort/Funktion/Status und «nur mit Firmware-Update», Suche, Export-Buttons, «Alle auf Updates prüfen» (nur lesend; aktive Geräte mit IP, 6 parallel über `/firmware/check`, geschützte nur mit optionalem Passwort)
3. **Gerätedetail:** Infos inkl. Standort (verschieben mit Rückfrage) und Funktion, Name/Stockwerk/Ort/Typ/Notizen (Inline-Edit; Namensvorschlag aus Stockwerk/Ort/Typ neben dem Namen, im Standort nummeriert; darunter Abgleich mit dem Gerätenamen und «Name auf Gerät schreiben» mit Rückfrage, Passwort inline), Config/Status/Geräteinfo als einklappbarer JSON-Baum, Snapshot-Historie mit Vergleich zweier Snapshots, Aktionen (Snapshot, Reboot mit Rückfrage, Reset-Dialog, Firmware prüfen/installieren mit Rückfrage), letzte Aktionen
4. **Protokoll:** Aktionsliste
5. **Templates:** Liste, Editor (nur angehakte Einstellungen gehören zum Template, Eingabe hakt automatisch an), Anwenden mit Geräteauswahl, Vorschau pro Gerät, Passwortfeldern, «bei Bedarf neu starten», Fortschritt und Ergebnis pro Gerät
6. **Standorte:** Auswahl in der Kopfzeile (im Browser gemerkt), Verwaltung unter «Standorte»; das Gerätefeld `location` heisst im UI «Ort»
7. **Sprache:** Umschalter in der Kopfzeile ab zwei Sprachen, ohne Reload; Default Browsersprache, sonst Deutsch, im Browser gemerkt

**Übersetzungen (i18n):** eigene kleine Lösung ohne Abhängigkeit (`apps/web/src/app/core/i18n/`, Begründung in [docs/entwicklung.md](docs/entwicklung.md#übersetzungen-i18n)). Texte nur in `apps/web/src/locale/<code>.json` (i18next-JSON-v4-Format: `{{platzhalter}}`, Plural `_one`/`_other` über `count`, `**fett**`), `de.json` ist Quelle und Fallback. Im Code nur Keys: `{{ 'key' | t }}` bzw. `t('key')`; der Typ `TranslationKey` aus `de.json` macht falsche Keys zum Build-Fehler. Datum/Zahl/Sortierung über `dateTime`-Pipe, `formatNumber`, `compareText` (Locale der Sprache). Das UI übersetzt Fehlercodes (`errors.<code>`) und zeigt nie die `message` des Servers. Neue Sprache = neue Datei + eine Zeile in `LANGUAGES`.

Design schlicht und funktional; Tabellen müssen auf Laptop-Breite gut lesbar sein. Das eigene Design-System "Kern" (https://github.com/yfridelance/kern, Stencil-Web-Components, Dark Standard, Light umschaltbar) ist die Abhängigkeit `@yfridelance/kern` (gebautes Paket aus dem GitHub-Release): nur dessen Tokens und `kern-*`-Komponenten verwenden, kein UI-Framework. Fehlt etwas, wird es in Kern ergänzt und neu released, nicht in der App nachgebaut. Einbindung, Events und Test-Helfer: [docs/entwicklung.md](docs/entwicklung.md).

## 11. Testen ohne echte Geräte

Baue einen **Mock-Shelly-Server** (`apps/server/test/mock-shelly/`), der mehrere Geräte emuliert:
- mindestens ein Gen1-Gerät (mit und ohne Basic Auth)
- mindestens ein Gen2+-Gerät (mit und ohne Digest Auth)
- realistische Antworten für `/shelly`, `/settings`, `/status`, `/rpc`
- Reset/Reboot als Zustandsänderung, damit Tests das Ergebnis prüfen können

Umgesetzt in `apps/server/test/mock-shelly/`: ein HTTP-Server pro Gerät auf eigenem Port, eigenständige Digest-Prüfung (nicht `src/shelly/digest.ts`), Optionen `failing` (Methoden/Pfade mit Fehler), `dropConnectionOnReset`, `offlineAfterReset`, `updates` (Firmware-Angebote), `delayMs`, dazu `hang`- und `foreign`-Hosts. Configs sind beschreibbar (Gen1 `/settings`-Parameter, Gen2+ `<Komponente>.SetConfig`) und **strikt**: unbekannte Parameter/Felder ergeben einen Fehler, damit Planer-Fehler in Tests auffallen. Script-Methoden sind emuliert; Secrets landen in `state.secretsReceived`. `npm run mock -w apps/server` startet die Fleet für die manuelle Entwicklung.

Pflichttests:
- Gen-Erkennung aus `/shelly`
- Digest-Auth gegen den Mock (inkl. falsches Passwort)
- Scan mit Timeout-Hosts und Fehlern
- Upsert über MAC (IP-Wechsel behält Standort/Notizen)
- Reset-Endpoint verweigert ohne korrekte `confirmMac`

## 12. Vorgehen und Abnahme

Stand: Alle sechs Phasen sind umgesetzt und abgenommen (getestet gegen den Mock; echte Geräte noch nicht). Bei weiteren Änderungen gilt weiterhin: `npm run build` grün und `npm test` grün.

1. **Gerüst:** Server (Fastify, Health, Static, Config über Env), Angular-App mit Proxy, Migrationen. *Abnahme:* `npm run dev` startet beides, `/api/health` antwortet über Port 4200.
2. **Adapter + Mock:** Gen1- und RPC-Adapter, Digest-Auth, Mock-Server, Tests. *Abnahme:* Tests grün.
3. **Scan:** Job-Modell, Parallelität, Fortschritt, Upsert. *Abnahme:* Scan gegen Mock findet alle Geräte.
4. **Inventar-UI:** Liste, Detail, Standort/Notizen, Snapshots. *Abnahme:* Änderungen bleiben nach Neustart erhalten.
5. **Aktionen:** Reboot, Factory Reset mit Schutzmechanismen, Protokoll. *Abnahme:* Sicherheitsregeln aus Abschnitt 9 durch Tests belegt.
6. **Export + Container:** JSON/CSV-Export, `docker compose up --build` funktioniert. *Abnahme:* App unter Port 8080 nutzbar, Daten im Volume persistent.

## 13. Konventionen

- Code und Bezeichner auf Englisch, UI-Texte nur in den Locale-Dateien; Quelle Deutsch (Schweizer Schreibweise, kein ß). Neue Fehlercodes des Servers brauchen einen Text unter `errors.<code>` in `de.json`.
- TypeScript `strict`, keine `any` ohne Kommentar.
- Kleine, fokussierte Module; Adapter, Scan, DB und HTTP-Routen getrennt.
- Rohe Geräte-Antworten unverändert speichern; Normalisierung nur in eigenen Feldern.
- Bei unklarem Shelly-Verhalten: Doku prüfen, Annahme im Code kommentieren, nachfragen statt raten.
- Commits klein und pro Phase nachvollziehbar.

## 14. Templates (kuratierte Settings)

Code: `apps/server/src/templates/` (Schema `settings.ts`, Planer `planner.ts`), Anwenden in `DeviceService.applyTemplate`, Feldliste im UI in `apps/web/src/app/core/template-fields.ts` (Keys müssen mit dem Planer übereinstimmen), Labels unter `templateFields.<key>` in `apps/web/src/locale/de.json`.

| Template-Feld | Gen1 (`/settings…`) | Gen2+ |
|---|---|---|
| `mqtt.enable/server/user` | `mqtt_enable`, `mqtt_server`, `mqtt_user` | `MQTT.SetConfig` `enable/server/user` (Neustart nötig) |
| `mqtt.clientId` | `mqtt_id` (zugleich Topic-ID) | `client_id` |
| `mqtt.topicPrefix` | – | `topic_prefix` |
| MQTT-Passwort (beim Anwenden) | `mqtt_pass` | `pass` (zusammen mit `user`) |
| `cloud.enable` | `/settings/cloud?enabled` | `Cloud.SetConfig enable` |
| `device.name` (Platzhalter `{name}` `{floor}` `{location}` `{kind}` `{id}` `{mac}`, leere fallen weg) | `/settings?name=` (max. 30 Zeichen, Gen1-Changelog 1.9.0) | `Sys.SetConfig device.name` (Länge nicht dokumentiert, App-Grenze 64); leer/zu lang → `unsupported` `name_empty`/`name_too_long`; danach auch lokaler Name |
| `time.sntpServer/timezone/lat/lon` | `sntp_server`, `timezone` (+`tzautodetect=false`), `lat`, `lng` | `Sys.SetConfig sntp.server`, `location.tz/lat/lon` |
| `eco.ecoMode` | – (nicht dokumentiert) | `sys.device.eco_mode` |
| `eco.ledStatusDisable` | `led_status_disable` (nur manche Modelle) | – |
| `bluetooth.enable/rpc/observer` | – | `BLE.SetConfig` (`enable`/`observer` nur bei älterer FW) |
| `wifiAp.enable` (+ AP-Passwort beim Anwenden) | – (AP schliesst WLAN-Client aus) | `WiFi.SetConfig ap.enable`; **Einschalten nur mit `pass` im selben Aufruf** (FW ≥ 2.0, Changelog 2.0.0; die API-Doku nennt `pass` noch «optional», ein echtes Gerät mit 2.1.0 lehnt ab: «Invalid argument 'pass': should not be empty!»). Ohne Passwort: `unsupported`/`password`, Rest des Templates wird angewendet. `is_open` wird nicht gesendet. |
| `apRoaming.enable/threshold` | `ap_roaming_enabled`, `ap_roaming_threshold` | `wifi.roam.interval` (0 = aus, sonst bisheriger Wert bzw. 60), `rssi_thr` |
| `coiot.enable/updatePeriod/peer` | `coiot_enable`, `coiot_update_period`, `coiot_peer` | – |
| `script` | – | `Script.List/Create/Stop/PutCode (1024 B)/SetConfig/Start`, per Name, Code-Vergleich via `GetCode` |
| `network.sta` / `network.sta1` (`mode: dhcp\|static`, `ipFrom`, `netmask`, `gateway?`, `dns?`) | `/settings/sta` bzw. `/settings/sta1` mit `ipv4_method`, `ip`, `netmask`, `gateway`, `dns` (Antwort heisst `mask`/`gw`); ohne Gateway muss die Cloud aus sein | `WiFi.SetConfig {sta\|sta1: {ipv4mode, ip, netmask, gw, nameserver}}`; Gerät verbindet sich ~1 s später neu |

**Netzwerk (WLAN-IP):** SSID und WLAN-Passwort werden nie gesendet (Gen2-Doku: `pass` nur zusammen mit `ssid` nötig; Gen1 wendet `/settings/sta`-Parameter einzeln an – am echten Gerät noch zu bestätigen). Statische IPs plant `src/templates/ip-plan.ts` (`assignStaticIps`): pro Auswahl, sortiert nach Stockwerk (Gebäude-Reihenfolge), Ort und Name, bestehende statische IPs im Bereich bleiben, sonst nächste freie ab `ipFrom` (belegt = IP eines anderen Geräts im Inventar, Gateway, Netz/Broadcast; während laufender Anwendungen reserviert). Beim Anwenden: angefragte IP prüfen (`ip_conflict`, auch wenn unter der Adresse etwas per HTTP antwortet), Netzwerk-Schritte zuletzt und das aktive WLAN (erkannt über die SSID im Status) ganz zuletzt, danach das Gerät unter der neuen IP suchen (MAC-Prüfung), `devices.ip` nachführen, erst dann Snapshot und Neustart. Nicht wiedergefunden: Ergebnis `network.confirmed = false`, kein Snapshot/Neustart. Wechsel auf DHCP: alte IP prüfen, sonst `ip = NULL` (neu scannen).

Regeln: Nur Felder setzen, die die aktuelle Config des Geräts kennt (sonst `unsupported`, Grund `generation` oder `firmware`); gleiche Werte nicht senden; Platzhalter `{id}` (Gen1 Hostname, Gen2+ Geräte-ID) und `{mac}`; Gen1-Fehlermeldungen ohne Query-String.

## 15. Standorte

Ein Standort trennt Inventar, Templates und Protokoll (Haus, Kunde). Umsetzung: `site_id` an `devices`, `templates`, `action_log` (Migration 010, Standard-Standort 1). Regeln:

- Die MAC bleibt global eindeutig: ein Gerät gehört genau zu einem Standort. Ein Scan in Standort B, der ein Gerät von Standort A findet, meldet es nur (`snapshot: 'foreign'`, `foreignSite`), liest keine Config (keine Zugangsdaten von B an A-Geräte) und ändert nichts; verschoben wird nur explizit (`PATCH { siteId }`, im UI mit Rückfrage).
- IPs sind nur pro Standort eindeutig (getrennte Netze). `upsertSeenDevice`, `markMissing`, `updateDeviceIp`, `moveDevice` und die statische IP-Planung arbeiten pro Standort.
- Templates gelten nur für Geräte ihres Standorts; Vorschau und Anwenden prüfen das.
- Im UI heisst `devices.location` «Ort» (Raum), «Standort» ist der Site-Begriff. Der aktuelle Standort liegt in `SiteService` (localStorage); `SitesStore` lädt die Liste nur dort, wo sie gebraucht wird.

