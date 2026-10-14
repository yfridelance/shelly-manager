# AGENTS.md – Shelly Manager

Briefing für Coding-Agents. Lies dieses Dokument vollständig, bevor du Code schreibst.

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

### Nicht im MVP (Datenmodell aber vorbereiten)
- Bulk-Settings, Templates, Drift-Erkennung
- Multi-Site mit Agents/Collectors
- Benutzerverwaltung / Login (App läuft lokal bzw. hinter Reverse Proxy)
- Persistente Speicherung von Gerätepasswörtern
- mDNS/CoIoT-Discovery
- Firmware-Updates (optional, falls Zeit bleibt; niedrige Priorität)
- Shelly Cloud, BLU-Geräte

## 3. Technologie-Stack (fix)

| Bereich | Wahl |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript (strict) |
| Backend | Fastify, `@fastify/static`, Schemas mit TypeBox (`@fastify/type-provider-typebox`) |
| DB | SQLite über `better-sqlite3`, SQL-Migrationen als nummerierte Dateien |
| Frontend | Angular 22, Standalone Components, Signals, SCSS |
| Monorepo | npm Workspaces (`apps/server`, `apps/web`) |
| Tests | Vitest (Server), Angular-Standard für Web |
| Container | Vorhandenes `Dockerfile`, `docker-compose.yml`, `.devcontainer/` |

Keine weiteren schweren Abhängigkeiten ohne Begründung. Für HTTP zu den Geräten reicht das native `fetch` von Node; Digest Auth selbst implementieren (kleines, getestetes Modul).

## 4. Bestehende Dateien und Container-Vertrag

Folgende Dateien existieren bereits und definieren einen Vertrag. **Nicht brechen**, oder Dockerfile/README im selben Schritt anpassen:

| Punkt | Erwartung |
|---|---|
| Server-Build | `npm run build -w apps/server` → `apps/server/dist/main.js` (ESM, `"type": "module"`) |
| Web-Build | `npm run build -w apps/web` → `apps/web/dist/web/browser` |
| Root-Build | `npm run build` baut beide |
| Dev | `npm run dev -w apps/server` (tsx watch), `npm run start -w apps/web` (ng serve) |
| Env | `PORT` (Dev 3000, Container 8080), `DATA_DIR` (SQLite-Ablage), `STATIC_DIR` (nur Produktion: Angular-Bundle ausliefern), `LOG_LEVEL` |
| Health | `GET /api/health` → 200 `{ status: "ok" }` |
| Dev-Proxy | Angular leitet `/api` auf `http://localhost:3000` weiter (`proxy.conf.json`) |

Alle API-Routen liegen unter `/api`. In Produktion liefert Fastify das SPA aus, mit Fallback auf `index.html` für unbekannte Nicht-API-Pfade.

## 5. Shelly-API-Wissen

Es gibt faktisch **zwei Protokolle**. Gen3 und Gen4 sprechen dieselbe API wie Gen2.

### Erkennung
`GET http://<ip>/shelly` ist auf allen Generationen **ohne Auth** erreichbar.
- Antwort enthält Feld `gen` (2, 3, 4) → RPC-Gerät. Relevante Felder: `id`, `mac`, `model`, `gen`, `fw_id`, `ver`, `app`, `auth_en`.
- Kein Feld `gen` → Gen1. Relevante Felder: `type`, `mac`, `auth`, `fw`.

MAC normalisieren (Grossbuchstaben, ohne Trennzeichen). **Die MAC ist der Primärschlüssel**, nie die IP.

### Gen1 (REST)
- Auth: HTTP Basic (unverschlüsselt über HTTP)
- `GET /settings` – Config
- `GET /status` – Status
- `GET /reboot` – Neustart
- `GET /settings?reset=true` – Factory Reset (laut offizieller Gen1-Doku: Parameter `reset` auf `/settings`, „Will perform a factory reset of the device". Einen Endpoint `/reset` gibt es nicht.)

### Gen2+ (JSON-RPC 2.0)
- Endpoint `POST /rpc` mit `{ "id": 1, "method": "...", "params": {...} }`
- Auth: HTTP Digest, Algorithmus SHA-256, Realm = Geräte-ID; Benutzer ist immer `admin`
- `Shelly.GetDeviceInfo`, `Shelly.GetConfig`, `Shelly.GetStatus`
- `Shelly.Reboot`, `Shelly.FactoryReset`
- Optional: `Shelly.CheckForUpdate`, `Shelly.Update`

Referenz: offizielle Shelly-API-Dokumentation (shelly-api-docs.shelly.cloud). Bei Unsicherheiten dort nachsehen, nicht raten.

### Adapter-Interface
```ts
interface ShellyAdapter {
  getInfo(): Promise<DeviceInfo>;
  getConfig(): Promise<unknown>;   // rohes JSON, unverändert speichern
  getStatus(): Promise<unknown>;
  reboot(): Promise<void>;
  factoryReset(): Promise<void>;
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

```sql
devices (
  mac TEXT PRIMARY KEY,
  ip TEXT,
  gen INTEGER NOT NULL,          -- 1, 2, 3, 4
  model TEXT,                    -- Gen1: type, Gen2+: model
  app TEXT,                      -- Gen2+: app
  firmware TEXT,
  name TEXT,
  auth_required INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  notes TEXT,
  state TEXT NOT NULL DEFAULT 'active', -- active | reset | missing
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
)

config_snapshots (
  id INTEGER PRIMARY KEY,
  mac TEXT NOT NULL REFERENCES devices(mac),
  taken_at TEXT NOT NULL,
  info_json TEXT NOT NULL,
  config_json TEXT,
  status_json TEXT
)

action_log (
  id INTEGER PRIMARY KEY,
  mac TEXT NOT NULL,
  action TEXT NOT NULL,          -- reboot | factory_reset | snapshot | ...
  requested_at TEXT NOT NULL,
  finished_at TEXT,
  result TEXT,                   -- ok | error
  error TEXT
)
```
Zeitstempel als ISO 8601 UTC. Geräte nie löschen, wenn sie zurückgesetzt wurden: `state = 'reset'` setzen, damit die Dokumentation erhalten bleibt.

Vorbereitet für später (noch nicht anlegen, aber nicht verbauen): `sites`, `templates`, Zuordnung Gerät → Site.

## 8. REST-API (Vorschlag)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Health |
| POST | `/api/scans` | Scan starten (`{ range, credentials? }`) |
| GET | `/api/scans/:id` | Status/Fortschritt |
| GET | `/api/scans/:id/events` | SSE-Fortschritt (optional) |
| DELETE | `/api/scans/:id` | Scan abbrechen |
| GET | `/api/devices` | Liste |
| GET | `/api/devices/:mac` | Details inkl. letztem Snapshot |
| PATCH | `/api/devices/:mac` | `location`, `notes`, `name` (nur lokal, nicht aufs Gerät) |
| POST | `/api/devices/:mac/snapshot` | Config neu einlesen |
| POST | `/api/devices/:mac/reboot` | Neustart |
| POST | `/api/devices/:mac/factory-reset` | Reset, Body `{ confirmMac }` muss mit `:mac` übereinstimmen |
| GET | `/api/export.json` / `/api/export.csv` | Export |
| GET | `/api/actions` | Aktionsprotokoll |

## 9. Sicherheitsregeln (nicht verhandelbar)

- **Kein Bulk-Factory-Reset.** Reset nur pro Gerät, im UI mit Dialog, in dem die MAC oder der Gerätename eingetippt werden muss. Das Backend prüft `confirmMac` zusätzlich.
- Vor jedem Reset automatisch einen Config-Snapshot erstellen. Schlägt der Snapshot fehl, Reset blockieren (mit expliziter Override-Option im Dialog).
- Im Dialog darauf hinweisen: Nach dem Reset startet das Gerät im AP-Modus und ist aus dem Netz verschwunden.
- Passwörter nie loggen, nie persistieren, nie im Frontend-State länger als nötig halten.
- Fehler pro Gerät sauber zurückmelden; ein Fehler bei einem Gerät darf keinen Scan abbrechen.

## 10. Frontend

Ansichten:
1. **Scan:** IP-Bereich, optionale Zugangsdaten, Start/Abbruch, Fortschritt, Liste der Treffer
2. **Inventar:** Tabelle (Name, Modell, Gen, IP, MAC, Firmware, Standort, Status, zuletzt gesehen), Filter nach Gen/Standort/Status, Suche
3. **Gerätedetail:** Infos, Standort und Notizen (Inline-Edit), Config als einklappbarer JSON-Baum, Snapshot-Historie, Aktionen (Snapshot, Reboot, Reset)
4. **Protokoll:** Aktionsliste

Design schlicht und funktional; Tabellen müssen auf Laptop-Breite gut lesbar sein. Falls das eigene Web-Component-Design-System "Kern" verfügbar ist, dessen Komponenten verwenden; sonst schlichtes eigenes SCSS ohne UI-Framework.

## 11. Testen ohne echte Geräte

Baue einen **Mock-Shelly-Server** (`apps/server/test/mock-shelly/`), der mehrere Geräte emuliert:
- mindestens ein Gen1-Gerät (mit und ohne Basic Auth)
- mindestens ein Gen2+-Gerät (mit und ohne Digest Auth)
- realistische Antworten für `/shelly`, `/settings`, `/status`, `/rpc`
- Reset/Reboot als Zustandsänderung, damit Tests das Ergebnis prüfen können

Pflichttests:
- Gen-Erkennung aus `/shelly`
- Digest-Auth gegen den Mock (inkl. falsches Passwort)
- Scan mit Timeout-Hosts und Fehlern
- Upsert über MAC (IP-Wechsel behält Standort/Notizen)
- Reset-Endpoint verweigert ohne korrekte `confirmMac`

## 12. Vorgehen und Abnahme

Arbeite in dieser Reihenfolge. Nach jeder Phase muss `npm run build` grün sein und die Tests laufen.

1. **Gerüst:** Server (Fastify, Health, Static, Config über Env), Angular-App mit Proxy, Migrationen. *Abnahme:* `npm run dev` startet beides, `/api/health` antwortet über Port 4200.
2. **Adapter + Mock:** Gen1- und RPC-Adapter, Digest-Auth, Mock-Server, Tests. *Abnahme:* Tests grün.
3. **Scan:** Job-Modell, Parallelität, Fortschritt, Upsert. *Abnahme:* Scan gegen Mock findet alle Geräte.
4. **Inventar-UI:** Liste, Detail, Standort/Notizen, Snapshots. *Abnahme:* Änderungen bleiben nach Neustart erhalten.
5. **Aktionen:** Reboot, Factory Reset mit Schutzmechanismen, Protokoll. *Abnahme:* Sicherheitsregeln aus Abschnitt 9 durch Tests belegt.
6. **Export + Container:** JSON/CSV-Export, `docker compose up --build` funktioniert. *Abnahme:* App unter Port 8080 nutzbar, Daten im Volume persistent.

## 13. Konventionen

- Code und Bezeichner auf Englisch, UI-Texte auf Deutsch (Schweizer Schreibweise, kein ß).
- TypeScript `strict`, keine `any` ohne Kommentar.
- Kleine, fokussierte Module; Adapter, Scan, DB und HTTP-Routen getrennt.
- Rohe Geräte-Antworten unverändert speichern; Normalisierung nur in eigenen Feldern.
- Bei unklarem Shelly-Verhalten: Doku prüfen, Annahme im Code kommentieren, nachfragen statt raten.
- Commits klein und pro Phase nachvollziehbar.