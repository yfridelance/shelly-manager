#!/bin/bash
# Regenerates docs/img/*.png from the mock fleet: demo data on :3100, then headless Chrome.
# Prerequisites: npm run build, Google Chrome (or CHROME=/path/to/chrome), ports 3100 and 28001-28008 free (an own mock fleet,
# so a running `npm run dev:mock` is not touched).
# Uses only the mock fleet and a temporary database; apps/server/data is never touched.
set -e
DIR=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$DIR/../.." && pwd)
export SP=$(mktemp -d)
cleanup() { kill "$(cat "$SP/server.pid" 2>/dev/null)" "$(cat "$SP/mock.pid" 2>/dev/null)" 2>/dev/null || true; }
trap cleanup EXIT
"$DIR/setup.sh"
node "$DIR/shots.mjs" http://localhost:3100 "$ROOT/docs/img" "$SP/chrome-profile"
cleanup
rm -rf "$SP"
