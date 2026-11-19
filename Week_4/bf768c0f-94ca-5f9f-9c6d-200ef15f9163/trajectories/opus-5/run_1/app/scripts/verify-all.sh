#!/bin/sh
# Run every check in order against a freshly seeded club.
set -u
cd /app || exit 1

echo "== the pure modules =="
node --test "test/*.test.js" 2>&1 | tail -6

echo "== the themes =="
python3 scripts/contrast.py | tail -3

echo "== a clean seed =="
node scripts/reset.mjs | head -1

echo "== the seed, the logs and renaming =="
node test/verify-api3.mjs 2>&1 | tail -4

echo "== the API, part one =="
node test/verify-api.mjs 2>&1 | tail -4

echo "== the API, part two =="
node test/verify-api2.mjs 2>&1 | tail -4

echo "== a clean seed again =="
node scripts/reset.mjs | head -1

echo "== the browser =="
node test/verify-browser.mjs 2>&1 | tail -4
node test/verify-browser2.mjs 2>&1 | tail -4

echo "== back to a pristine club =="
node scripts/reset.mjs
