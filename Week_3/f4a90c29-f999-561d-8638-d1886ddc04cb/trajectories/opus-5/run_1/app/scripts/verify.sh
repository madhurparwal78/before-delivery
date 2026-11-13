#!/bin/sh
# Build, then run every check suite against fresh seed data.
set -e
cd /app
npm run build
go build -o bin/server .
for suite in \
  "python3 scripts/check.py" \
  "python3 scripts/domain-check.py" \
  "python3 scripts/service-check.py" \
  "node scripts/ui-check.mjs" \
  "node scripts/ui-journeys.mjs" \
  "node scripts/ui-layout.mjs"
do
  /tmp/reset/reset > /dev/null
  ./scripts/restart.sh > /dev/null
  sleep 3
  echo "== $suite"
  $suite | tail -2
done
# These two run their own server: one behind switchable proxies, one on a
# rehearsal clock.
for suite in "python3 scripts/outage-check.py" "python3 scripts/clock-check.py"; do
  /tmp/reset/reset > /dev/null
  ./scripts/stop.sh
  echo "== $suite"
  $suite | tail -2
done
