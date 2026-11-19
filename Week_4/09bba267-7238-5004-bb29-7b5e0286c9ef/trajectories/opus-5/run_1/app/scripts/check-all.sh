#!/bin/sh
# Full local check: clean database, rebuild, serve, then run the API and browser checks.
set -u
cd /app || exit 1
npx tsx scripts/reset-db.ts || exit 1
npm run build > /dev/null || exit 1
sh scripts/serve.sh "${1:-600}" "${2:-900}" || exit 1
npx playwright test || exit 1
npx tsx scripts/api-smoke.ts || exit 1
npx tsx scripts/waitlist-smoke.ts || exit 1
npx tsx scripts/outage-smoke.ts || exit 1
sh scripts/serve.sh "${1:-600}" "${2:-900}" 
