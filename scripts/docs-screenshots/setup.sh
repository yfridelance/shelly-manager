#!/bin/bash
# Fresh mock fleet + isolated server on :3100 with realistic demo data for screenshots.
set -e
# Needs a built app (npm run build). Data goes to $SP (default: a temp dir), never to apps/server/data.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SP=${SP:-$(mktemp -d)}
rm -rf "$SP/shots-data"
# Mock fleet and server run in the background; their PIDs go to $SP so run.sh stops exactly these.
cd "$ROOT/apps/server"
node --import tsx test/mock-shelly/cli.ts > "$SP/shots-mock.log" 2>&1 < /dev/null &
echo $! > "$SP/mock.pid"
cd "$ROOT"
PORT=3100 DATA_DIR="$SP/shots-data" STATIC_DIR=apps/web/dist/web/browser SHELLY_HOST_MAP=10.99.0.0/24=127.0.0.1:18000 LOG_LEVEL=warn \
  node apps/server/dist/main.js > "$SP/shots-server.log" 2>&1 < /dev/null &
echo $! > "$SP/server.pid"
API=http://localhost:3100/api
for i in $(seq 1 50); do curl -sf $API/health >/dev/null && break; sleep 0.2; done
scan() { id=$(curl -s -X POST $API/scans -H 'Content-Type: application/json' -d "$1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])'); sleep 3.5; }
scan '{"range":"10.99.0.0/24"}'
scan '{"range":"10.99.0.2","credentials":{"password":"gen1-secret"}}'
scan '{"range":"10.99.0.4","credentials":{"password":"gen2-secret"}}'
scan '{"range":"10.99.0.6","credentials":{"password":"gen4-secret"}}'
patch() { curl -s -o /dev/null -X PATCH $API/devices/$1 -H 'Content-Type: application/json' -d "$2"; }
patch E868E7A1B2C3 '{"location":"Keller","notes":"Deckenlicht, Sicherung F2"}'
patch E868E7D4E5F6 '{"location":"Wohnzimmer","notes":"Storen Südseite"}'
patch A8032AB12345 '{"location":"Keller","notes":"Boiler-Freigabe, Sicherung F7"}'
patch A8032AB67890 '{"location":"Büro","notes":"Rollladen Fenster Ost"}'
patch 34CDB0A1A1A1 '{"name":"Aussenlicht","location":"Garten"}'
patch 7C2C67B2B2B2 '{"location":"Garage","notes":"Torantrieb"}'
curl -s -o /dev/null -X POST $API/templates -H 'Content-Type: application/json' -d '{"name":"Haus-Standard","description":"MQTT für Home Assistant, Cloud aus","settings":{"mqtt":{"enable":true,"server":"mqtt.home:1883","topicPrefix":"haus/{id}"},"cloud":{"enable":false},"time":{"timezone":"Europe/Zurich","sntpServer":"ch.pool.ntp.org"},"coiot":{"enable":false}}}'
# Boiler already got the template (for the before/after comparison and the log).
curl -s -o /dev/null -X POST $API/devices/A8032AB12345/apply-template -H 'Content-Type: application/json' -d '{"templateId":1,"rebootIfRequired":true}'
curl -s -o /dev/null -X POST $API/devices/7C2C67B2B2B2/reboot -H 'Content-Type: application/json' -d '{"credentials":{"password":"gen4-secret"}}'
curl -s $API/devices | python3 -c 'import sys,json;print(len(json.load(sys.stdin)),"Geräte")'
