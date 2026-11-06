#!/bin/sh
# Resets the services, serves the build and walks every suite.
set -e
cd /app
sh checks/restart.sh > /dev/null
node scripts/scratch.mjs checks/reset-db.ts > /dev/null
curl -s -X DELETE http://mailpit:8025/api/v1/messages > /dev/null
npm run build 2>&1 | tail -1
node dist/server/index.js > /tmp/server.log 2>&1 &
sleep 9
sh checks/instances.sh > /dev/null

# The browser walk goes first, while the seed is untouched, so the comparison stage
# shows the pair the brief publishes.
echo "== the screens in a browser =="
node checks/ui.mjs 2>&1 | grep -E "FAIL|failures|console errors"
echo "== journeys =="
node scripts/scratch.mjs checks/e2e.ts | tail -2
echo "== working a day =="
node scripts/scratch.mjs checks/e2e2.ts | tail -2
echo "== races, lapses and outages =="
node scripts/scratch.mjs checks/races.ts | tail -2
echo "== uploads, streams, dunning and vet links =="
node scripts/scratch.mjs checks/behaviour.ts | tail -2
echo "== the brief's worked examples =="
node scripts/scratch.mjs checks/examples.ts | tail -2
