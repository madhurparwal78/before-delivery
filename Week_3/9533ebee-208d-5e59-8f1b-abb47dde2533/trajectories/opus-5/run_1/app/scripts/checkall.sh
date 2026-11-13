#!/bin/sh
# Runs every server suite against a freshly seeded market.
#
#   sh scripts/checkall.sh
#
# The browser suites under tests/ui need Playwright, which is not a dependency
# of the app. Install it on demand with:
#   npm i --no-save playwright && npx playwright install --with-deps chromium
set -e
cd "$(dirname "$0")/.."

STATUS=0
run() {
  name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@"; then :; else
    STATUS=1
    printf '!!! %s FAILED\n' "$name"
  fi
}

printf '=== typecheck ===\n'
npx tsc --noEmit
printf 'typecheck clean\n'

printf '\n=== formatting ===\n'
npx prettier --check "src/**/*.{ts,css,html}" "scripts/*.mjs"

printf '\n=== licences ===\n'
node scripts/notices.mjs

run "desk formats" node scripts/runts.mjs tests/deskformat.mts
run "domain units" node scripts/runts.mjs tests/domain.mts
run "seed" node scripts/runts.mjs tests/seed.mts

./scripts/reset.sh >/dev/null
run "api: boundary and roles" node tests/api-boundary.mjs

./scripts/reset.sh >/dev/null
run "api: oracle baseline" node tests/api-oracle-baseline.mjs

./scripts/reset.sh >/dev/null
run "api: lending" node tests/api-lending.mjs

./scripts/reset.sh GRACE_SECONDS=6 >/dev/null
run "api: liquidation" node tests/api-liquidation.mjs

./scripts/reset.sh GRACE_SECONDS=4 >/dev/null
run "api: write-off" node tests/api-writeoff.mjs
run "storage and events" node scripts/runts.mjs tests/storage.mts

./scripts/reset.sh STALENESS_SECONDS=5 GRACE_SECONDS=4 >/dev/null
run "api: stale feed" node tests/api-stale.mjs

./scripts/reset.sh >/dev/null
run "db loss and recovery" node scripts/runts.mjs tests/dbloss.mts

run "boot configuration" node tests/boot.mjs

./scripts/reset.sh >/dev/null
printf '\n=== server suites done ===\n'
exit $STATUS
