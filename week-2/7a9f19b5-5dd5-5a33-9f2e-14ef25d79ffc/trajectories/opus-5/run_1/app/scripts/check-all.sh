#!/bin/sh
# Runs every verification suite, each against a freshly reset database.
# Usage: sh scripts/check-all.sh
set -e
cd /app

run() {
  name=$1
  shift
  printf '\n========== %s ==========\n' "$name"
  sh scripts/restart.sh --reset > /dev/null 2>&1
  curl -s -X DELETE "${MAILPIT_URL:-http://mailpit:8025}/api/v1/messages" > /dev/null || true
  node "$@" 2>&1 | tail -6
}

run "API: catalogue, roles, cart, boundary, projects" scripts/apitest.mjs
run "API: payments, invoices, stock, email, storage" scripts/apitest2.mjs
run "API: overselling race, trade approval" scripts/apitest3.mjs
run "UI: roles, names, panels, layouts, design" scripts/uitest.mjs
run "UI: journeys, room, collaboration, admin" scripts/uitest2.mjs
run "UI: touch targets, contrast, newsletter" scripts/uitest3.mjs
run "UI: dialog focus, admin at 375, comparison" scripts/uitest4.mjs

printf '\n========== licences ==========\n'
node scripts/licences.mjs | tail -2
