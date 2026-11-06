#!/bin/bash
# Development test runner: each suite runs against a fresh database.
set -e
cd /app

reset_db() {
  local pids=$(ls /proc | grep -E '^[0-9]+$' | while read p; do grep -q 'dist/server/main.js' /proc/$p/cmdline 2>/dev/null && echo $p; done)
  if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; fi
  sleep 1
  node -e "
const {Client} = require('pg');
const c = new Client({connectionString: process.env.DATABASE_URL});
c.connect().then(async()=>{ await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();});"
  sleep 1
  (node dist/server/main.js > /tmp/server.log 2>&1 &)
  sleep 5
}

# the browser suites need playwright-core, which lives outside the shipped tree
mkdir -p /tmp/node_modules
ln -sfn /tmp/node_modules tests/node_modules
if [ ! -d /tmp/node_modules/playwright-core ]; then
  (cd /tmp && npm install playwright-core --no-audit --no-fund >/dev/null 2>&1)
fi

echo "=== shared modules ==="
npm run test:shared 2>&1 | grep -E 'ALL OK|FAILURES|FAIL '

echo "=== api smoke ==="
reset_db
python3 tests/api_smoke.py 2>&1 | grep -E 'ALL OK|FAILURES|FAIL ' 

echo "=== browser smoke ==="
reset_db
cd /tmp && node /app/tests/browser_smoke.mjs 2>&1 | grep -E 'ALL OK|FAILURES|FAIL ' 
cd /app

echo "=== two devices ==="
reset_db
cd /tmp && node /app/tests/two_devices.mjs 2>&1 | grep -E 'ALL OK|FAILURES|FAIL ' 
cd /app

echo "=== share reader ==="
reset_db
cd /tmp && node /app/tests/share_reader.mjs 2>&1 | grep -E 'ALL OK|FAILURES|FAIL ' 
cd /app

echo "=== board and timeline ==="
reset_db
cd /tmp && node /app/tests/board_timeline.mjs 2>&1 | grep -E 'ALL OK|FAILURES|FAIL ' 
cd /app

echo "=== lockout ==="
python3 tests/lockout_test.py 2>&1 | grep -E 'ALL OK|FAILURES|FAIL '

echo "=== storage outage ==="
python3 tests/storage_outage_test.py 2>&1 | grep -E 'ALL OK|FAILURES|FAIL '
