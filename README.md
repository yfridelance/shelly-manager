# Shelly Manager

[![CI](https://github.com/yfridelance/shelly-manager/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/yfridelance/shelly-manager/actions/workflows/ci.yml)

Selbst gehostete Web-App, die Shelly-Geräte (Gen1 bis Gen4) im lokalen Netz findet, dokumentiert und verwaltet.

- **Scan** eines IP-Bereichs mit Erkennung von Generation, Modell, Geräte-ID, MAC, Firmware und Name
- **Inventar** mit Suche, Filtern, Standort und Notizen pro Gerät, Export als CSV und JSON
- **Config-Snapshots** mit Historie und Vergleich zweier Stände
- **Neustart, Firmware-Updates** und **Werksreset pro Gerät** mit Schutzmechanismen
  (Bestätigung per MAC, automatischer Snapshot vorher, kein Sammel-Reset)
- **Templates**: Einstellungen wie MQTT, Cloud, Zeit, Bluetooth oder Scripts mit Vorschau auf mehrere Geräte anwenden,
  für Gen1 und Gen2+ übersetzt
- **Protokoll** aller Aktionen; Gerätepasswörter werden nie gespeichert

## Schnellstart

```bash
docker compose up -d --build
```

Danach läuft die App unter **http://localhost:8080**. Im UI unter «Scan» den IP-Bereich eingeben, z.B. `192.168.1.0/24`.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [Benutzerhandbuch](docs/benutzerhandbuch.md) | Bedienung: Scan, Inventar, Gerätedetail, Werksreset, Firmware, Templates, Protokoll, Export, Fehlerbehebung |
| [Betrieb](docs/betrieb.md) | Docker, Netzwerk, Reverse Proxy und `ALLOWED_HOSTS`, Umgebungsvariablen, Backup, Updates, Betrieb ohne Docker |
| [Entwicklung](docs/entwicklung.md) | Setup, Architektur, Datenbank, Tests und Mock-Fleet, CI, Erweitern |
| [CLAUDE.md](CLAUDE.md) | Verbindliche Regeln und Referenz: Vertrag, Shelly-API-Wissen, Datenmodell, REST-API, Sicherheitsregeln |

## Entwicklung in Kürze

Voraussetzung: Node.js 24 (mindestens 24.15), z.B. per `nvm use`.

```bash
npm install
npm run dev        # Server :3000 + Angular :4200
npm run dev:mock   # zusätzlich Mock-Shelly-Fleet; im UI 10.99.0.0/24 scannen
npm run build
npm test
```

Details in [docs/entwicklung.md](docs/entwicklung.md).

## Sicherheit

Die App hat kein Login und kann Geräte zurücksetzen. Der Docker-Port ist deshalb nur an `127.0.0.1` gebunden, und
die API akzeptiert nur erlaubte Hostnamen. Für den Zugriff von anderen Rechnern einen Reverse Proxy mit Anmeldung
davorsetzen; siehe [Betrieb](docs/betrieb.md#zugriff-von-anderen-rechnern).
