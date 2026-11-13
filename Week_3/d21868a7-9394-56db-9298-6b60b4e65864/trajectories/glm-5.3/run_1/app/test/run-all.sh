#!/bin/sh
# Run the full Ditchbook test suite against a fresh database.
set -e
cd /app
echo "=== unit: district time ==="
npx tsx test/district-time.test.ts | tail -2
echo "=== unit: domain rules ==="
npx tsx test/domain.test.ts | tail -2
echo "=== api e2e ==="
./test/run-with-fresh-db.sh python3 test/api-e2e.py | tail -2
echo "=== api: DST + lapse ==="
./test/run-with-fresh-db.sh python3 test/api-lapse-dst.py | tail -2
echo "=== api: final compliance checks ==="
./test/run-with-fresh-db.sh python3 test/api-final-checks.py | tail -2
echo "=== api: search reach and shapes ==="
./test/run-with-fresh-db.sh python3 test/api-search-shapes.py | tail -2
echo "=== outage: store ==="
node -e "import('pg').then(async ({default: pg}) => { const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await pool.end(); })"
python3 /tmp/killserver.py > /dev/null 2>&1 || true
sleep 1
node test/outage.test.mjs 2>&1 | grep -E "ALL OK|FAILURES|FAIL " | tail -2
if [ $? -ne 0 ]; then echo "OUTAGE STORE FAILED"; fi
echo "=== outage: mail ==="
node -e "import('pg').then(async ({default: pg}) => { const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await pool.end(); })"
python3 /tmp/killserver.py > /dev/null 2>&1 || true
sleep 1
node test/mail-outage.test.mjs 2>&1 | grep -E "ALL OK|FAILURES|FAIL " | tail -2
if [ $? -ne 0 ]; then echo "OUTAGE MAIL FAILED"; fi
echo "=== browser: grower ordering (journey 1) ==="
./test/run-with-fresh-db.sh python3 test/browser-smoke.py | tail -2
echo "=== browser: field stroke (journey 3) ==="
./test/run-with-fresh-db.sh python3 test/browser-field.py | tail -2
echo "=== browser: board, restriction, ration, capacity (journeys 4+6) ==="
./test/run-with-fresh-db.sh python3 test/browser-board.py | tail -2
echo "=== browser: contested capacity (journey 2) ==="
./test/run-with-fresh-db.sh python3 test/browser-contested.py | tail -2
echo "=== browser: handover + draft restore (journeys 5+1) ==="
./test/run-with-fresh-db.sh python3 test/browser-handover.py | tail -2
echo "=== browser: packs, erasure, review (journeys 7+8) ==="
./test/run-with-fresh-db.sh python3 test/browser-packs.py | tail -2
echo "=== browser: live updates ==="
./test/run-with-fresh-db.sh python3 test/browser-live.py | tail -2
echo "=== browser: viewports + tap targets ==="
./test/run-with-fresh-db.sh python3 test/browser-viewports.py | tail -2
echo "=== browser: edge cases ==="
./test/run-with-fresh-db.sh python3 test/browser-edge.py | tail -2
echo "=== browser: frozen device clock ==="
./test/run-with-fresh-db.sh python3 test/browser-clock.py | tail -2
echo
echo "SUITE COMPLETE"
