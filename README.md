# Shelly Manager

Selbst gehostete Web-App zum Finden, Inventarisieren und Verwalten von Shelly-Geräten (Gen1–Gen4).
Details zu Ziel, Scope und Architektur: [CLAUDE.md](CLAUDE.md).

## Voraussetzungen

- Node.js 24 LTS, mindestens 24.15 (Angular CLI 22). Mit nvm: `nvm use` (liest `.nvmrc`).
- Alternativ: `.devcontainer/` für VS Code Dev Containers (Ports 4200 und 3000 werden weitergeleitet).

## Entwicklung

```bash
npm install
npm run dev            # Server (Port 3000, tsx watch) + Angular (Port 4200, Proxy /api → 3000)
npm run build          # apps/server/dist und apps/web/dist/web/browser
npm test               # Vitest (Server) + Angular-Tests (Web)
npm run dev:mock       # wie dev, plus Mock-Shelly-Fleet; im UI 10.99.0.0/24 scannen
```

### Ohne echte Geräte entwickeln

`npm run dev:mock` startet zusätzlich eine Mock-Fleet (Gen1–Gen4, mit und ohne Passwort, ein hängender Host,
ein fremder HTTP-Server) auf den Ports 18001–18008 und leitet den Bereich `10.99.0.0/24` per `SHELLY_HOST_MAP`
dorthin um. Die Datenbank liegt dann separat in `apps/server/data/mock`. Die Testpasswörter gibt das Mock-Skript
beim Start aus.

## Betrieb mit Docker

```bash
docker compose up -d --build   # App unter http://localhost:8080
docker compose down            # stoppt; Daten bleiben im Volume shelly-data
```

- Die SQLite-Datenbank liegt im benannten Volume `shelly-data` (`/data` im Container) und übersteht
  Neustarts und Rebuilds. `docker compose down -v` löscht sie.
- Der Port ist nur auf `127.0.0.1` gebunden, weil die App kein Login hat und Geräte zurücksetzen kann.
  Für Zugriff von anderen Rechnern einen Reverse Proxy mit Authentifizierung davorsetzen.
- Gescannt wird über das Docker-Bridge-Netz (ausgehende HTTP-Anfragen ins LAN). Den IP-Bereich gibt man
  im UI an; das Container-interne Netz wird nicht automatisch erkannt.

## Templates

Unter «Templates» lassen sich Einstellungen (MQTT, Cloud, Zeit/Standort, Eco/LED, Bluetooth, WLAN-AP, AP-Roaming,
CoIoT, Scripts) als Template speichern und auf mehrere Geräte anwenden. Die App übersetzt sie je Generation, zeigt
vorher pro Gerät, was sich ändert, sichert vor und nach dem Anwenden einen Snapshot und protokolliert jede Änderung.
MQTT- und AP-Passwort werden nur beim Anwenden eingegeben und nie gespeichert.

## Export

Im Inventar oder direkt per API:

- `GET /api/export.csv`: Übersicht für Excel (Semikolon, UTF-8 mit BOM, Zeiten in UTC)
- `GET /api/export.json`: alle Geräte inkl. neuster Config, Status und Geräteinfo (rohe Geräteantworten)
- `GET /api/export.json?snapshots=all`: zusätzlich alle älteren Snapshots

Gerätepasswörter werden nie gespeichert und sind daher auch nicht im Export.

## Umgebungsvariablen (Server)

| Variable | Default | Zweck |
|---|---|---|
| `PORT` | `3000` | HTTP-Port (Container: `8080`) |
| `HOST` | `127.0.0.1` | Bind-Adresse; im Container `0.0.0.0` |
| `DATA_DIR` | `./data` | Ablage der SQLite-Datenbank |
| `STATIC_DIR` | – | Nur Produktion: Angular-Bundle ausliefern (SPA-Fallback auf `index.html`) |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, `silent` |
| `SHELLY_HOST_MAP` | – | Nur Entwicklung/Tests: IPs auf Mock-Geräte umleiten, z.B. `10.99.0.0/24=127.0.0.1:18000` |

SQL-Migrationen liegen nummeriert in `apps/server/migrations/` und laufen beim Start automatisch.
