#!/bin/sh
# Run every browser pass against a fresh seed.
set -e
cd /app

reseed() {
  node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => { await pool.query('delete from workspaces'); await pool.end(); })();
"
  sleep 1
  curl -sS -X POST http://127.0.0.1:4173/api/grading/setup \
    -H 'Content-Type: application/json' -H "X-Grading-Key: $GRADING_KEY" \
    -d @/tmp/seed.json -o /dev/null
  echo "reseeded"
}

echo '=== pass 1: build a plan ==='
reseed
node tests/browser-check.js

echo '=== pass 2: drag, holidays, links, live, phone ==='
reseed
node tests/browser-check-2.js

echo '=== pass 3: details, conflicts, presence, reorder ==='
reseed
node tests/browser-check-3.js

echo '=== axe at the three sizes ==='
node tests/axe-check.js
