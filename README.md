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
```

## Umgebungsvariablen (Server)

| Variable | Default | Zweck |
|---|---|---|
| `PORT` | `3000` | HTTP-Port (Container: `8080`) |
| `HOST` | `127.0.0.1` | Bind-Adresse; im Container `0.0.0.0` |
| `DATA_DIR` | `./data` | Ablage der SQLite-Datenbank |
| `STATIC_DIR` | – | Nur Produktion: Angular-Bundle ausliefern (SPA-Fallback auf `index.html`) |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, `silent` |

SQL-Migrationen liegen nummeriert in `apps/server/migrations/` und laufen beim Start automatisch.
