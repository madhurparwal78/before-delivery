#!/bin/sh
# Reset the dev database, restart the app, and run a browser test.
set -e
cd /app
node -e "import('pg').then(async ({default: pg}) => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.end();
}).catch(() => process.exit(0))"
python3 /tmp/killserver.py > /dev/null 2>&1 || true
sleep 1
node dist/server/main.js > /tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 5
"$@"
RC=$?
python3 /tmp/killserver.py > /dev/null 2>&1 || true
exit $RC
