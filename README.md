# Shelly Manager

Selbst gehostete Web-App zum Finden, Inventarisieren und Verwalten von Shelly-Geräten (Gen1–Gen4).
Details zu Ziel, Scope und Architektur: [CLAUDE.md](CLAUDE.md).

## Voraussetzungen

- Node.js 24 LTS, mindestens 24.15 (Angular CLI 22). Mit nvm: `nvm use` (liest `.nvmrc`).

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
