# Betrieb

Installation, Konfiguration, Netzwerk, Zugriff von aussen, Backup und Updates. Die Bedienung steht im
[Benutzerhandbuch](benutzerhandbuch.md), die Entwicklung in [entwicklung.md](entwicklung.md).

## Mit Docker (empfohlen)

Voraussetzung: Docker mit Compose v2.

```bash
git clone https://github.com/yfridelance/shelly-manager.git
cd shelly-manager
docker compose up -d --build
```

Die App ist danach unter **http://localhost:8080** erreichbar.

| Befehl | Wirkung |
|---|---|
| `docker compose up -d --build` | bauen und starten |
| `docker compose logs -f` | Logs verfolgen |
| `docker compose ps` | Status inkl. Healthcheck (`/api/health`) |
| `docker compose stop` / `start` | anhalten / wieder starten |
| `docker compose down` | Container entfernen, **Daten bleiben** im Volume |
| `docker compose down -v` | Container **und Datenbank** löschen |

Eigenschaften des Images:

- Mehrstufiger Build auf `node:24-bookworm-slim`; im Image steckt nur der Server mit seinen Produktionsabhängigkeiten
  und das gebaute Web-Frontend.
- Läuft als Benutzer `node`, nicht als root.
- Die SQLite-Datenbank liegt in `/data`, gemountet als benanntes Volume `shelly-data`
  (Docker-Name: `shelly-manager_shelly-data`).
- Datenbank-Migrationen laufen beim Start automatisch.

### Port und Erreichbarkeit

`docker-compose.yml` bindet den Port **nur an `127.0.0.1:8080`**. Die App hat kein Login und kann Geräte auf
Werkseinstellungen zurücksetzen; sie soll deshalb nicht direkt im ganzen Netz erreichbar sein. Für den Zugriff von
anderen Rechnern siehe [unten](#zugriff-von-anderen-rechnern).

## Netzwerk und Scannen

Die App scannt den IP-Bereich, den du im UI angibst, per HTTP (`GET /shelly`). Aus dem Container heraus läuft das
über das Docker-Bridge-Netz: Ausgehende Verbindungen ins LAN funktionieren, solange der Host das Zielnetz erreicht.
Eine automatische Erkennung des eigenen Subnetzes gibt es bewusst nicht; im Container wäre das nur das interne
Docker-Netz.

- **Mehrere Netze/VLANs:** Gescannt werden kann alles, was der Host routet. Firewall-Regeln zwischen VLANs müssen
  HTTP (Port 80) zu den Shellys erlauben.
- **Linux und `network_mode: host`:** Falls das LAN aus dem Bridge-Netz nicht erreichbar ist, kann der Container im
  Host-Netz laufen. **Achtung:** Die Port-Bindung aus `docker-compose.yml` gilt dann nicht mehr. Im Image ist
  `HOST=0.0.0.0` gesetzt, die App wäre also im ganzen Netz erreichbar. In diesem Fall `HOST=127.0.0.1` setzen.
- **Docker Desktop (macOS/Windows):** Das Scannen ins Heim-LAN funktioniert über das Bridge-Netz.

## Zugriff von anderen Rechnern

Empfohlen ist ein Reverse Proxy **mit Anmeldung** vor der App. Zwei Dinge sind dabei wichtig:

1. **`ALLOWED_HOSTS` setzen.** Die API nimmt nur Anfragen an, deren Host-Header ein erlaubter Name ist (Schutz gegen
   DNS-Rebinding). Immer erlaubt sind `localhost`, `*.localhost`, `127.0.0.1` und `::1`. Den Namen, unter dem der
   Proxy die App anbietet, musst du ergänzen, sonst antwortet die API mit 403 «Zugriff über diesen Hostnamen ist nicht
   erlaubt». Schreibende Anfragen mit einem fremden `Origin`-Header werden ebenfalls abgelehnt.
2. **Den Host-Header weiterreichen** und für den Scan-Fortschritt (Server-Sent Events) **nicht puffern**.

`docker-compose.yml` ergänzen:

```yaml
services:
  shelly-manager:
    environment:
      LOG_LEVEL: info
      ALLOWED_HOSTS: shelly.example.lan
```

**Caddy** (reicht den Host-Header standardmässig weiter):

```caddyfile
shelly.example.lan {
	basic_auth {
		# Hash mit: caddy hash-password
		yves $2a$14$...
	}
	reverse_proxy 127.0.0.1:8080
}
```

**nginx:**

```nginx
server {
    server_name shelly.example.lan;
    # listen/ssl nach eigener Konfiguration

    location / {
        auth_basic           "Shelly Manager";
        auth_basic_user_file /etc/nginx/shelly.htpasswd;

        proxy_pass         http://127.0.0.1:8080;
        proxy_set_header   Host $host;
        proxy_http_version 1.1;
        proxy_buffering    off;   # Scan-Fortschritt (SSE)
    }
}
```

Läuft der Proxy selbst als Container im selben Compose-Netz, spricht er die App als `shelly-manager:8080` an; die
Port-Bindung an `127.0.0.1` spielt dann keine Rolle.

## Umgebungsvariablen

| Variable | Default | Im Container | Zweck |
|---|---|---|---|
| `PORT` | `3000` | `8080` | HTTP-Port |
| `HOST` | `127.0.0.1` | `0.0.0.0` | Bind-Adresse |
| `DATA_DIR` | `./data` | `/data` | Ablage der SQLite-Datenbank (`shelly-manager.sqlite`) |
| `STATIC_DIR` | – | `/app/web` | Angular-Bundle ausliefern (nur Produktion), mit Fallback auf `index.html` |
| `LOG_LEVEL` | `info` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `ALLOWED_HOSTS` | – | – | Zusätzliche erlaubte Hostnamen, kommagetrennt, `*.` als Wildcard (z.B. `shelly.example.lan,*.home.arpa`) |
| `SHELLY_HOST_MAP` | – | – | Nur Entwicklung/Tests: IPs auf Mock-Geräte umleiten |

Passwörter werden nie geloggt, auch nicht mit `LOG_LEVEL=trace`.

## Backup und Wiederherstellung

Alle Daten liegen in einer SQLite-Datenbank (mit WAL-Dateien) im Volume. Für ein konsistentes Backup den Container
kurz anhalten:

```bash
docker compose stop
docker run --rm -v shelly-manager_shelly-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/shelly-data-$(date +%F).tgz -C /data .
docker compose start
```

Wiederherstellen (überschreibt die aktuelle Datenbank):

```bash
docker compose down
docker run --rm -v shelly-manager_shelly-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/shelly-data-YYYY-MM-DD.tgz -C /data'
docker compose up -d
```

Zusätzlich eignet sich der **JSON-Export** (Inventar → «JSON mit allen Snapshots») als lesbare Dokumentation, die
unabhängig von der App bleibt. Ein Import ist nicht vorgesehen.

## Updates der App

```bash
# vorher ein Backup machen (siehe oben)
git pull
docker compose up -d --build
```

Neue Datenbank-Migrationen laufen beim Start automatisch. Ein Zurückgehen auf eine ältere Version wird nicht
unterstützt; dafür ist das Backup da.

## Ohne Docker

Voraussetzung: Node.js 24, mindestens **24.15** (wegen Angular CLI 22), mit npm ≥ 11.19.

```bash
npm ci
npm run build
PORT=8080 HOST=127.0.0.1 DATA_DIR=/var/lib/shelly-manager \
  STATIC_DIR=apps/web/dist/web/browser \
  node apps/server/dist/main.js
```

npm ab 11.19 blockiert Install-Scripts. Die nötigen Pakete (u.a. `better-sqlite3` mit seinem nativen Modul) sind in
`allowScripts` der Root-`package.json` freigegeben. Fehlt das native Modul, meldet der Start einen Fehler beim Laden
von `better-sqlite3`; dann `npm rebuild better-sqlite3` ausführen.

Die App beendet sich bei `SIGINT`/`SIGTERM` sauber (laufender Scan wird abgebrochen, Datenbank geschlossen), eignet
sich also auch für einen systemd-Dienst.
