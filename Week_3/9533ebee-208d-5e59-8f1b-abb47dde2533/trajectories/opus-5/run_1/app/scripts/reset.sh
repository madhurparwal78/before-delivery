#!/bin/sh
# Rebuild, reseed and restart the server for a clean development run.
# Extra arguments are environment overrides, for example GRACE_SECONDS=5.
set -e
cd "$(dirname "$0")/.."
npm run build >/dev/null
node scripts/serverctl.mjs stop >/dev/null
node scripts/runts.mjs src/db/reseed.ts
node scripts/serverctl.mjs start "$@" >/dev/null
for i in $(seq 1 40); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/api/health)" = "200" ]; then
    echo "server ready"
    exit 0
  fi
  sleep 0.5
done
echo "server did not become ready" >&2
exit 1
