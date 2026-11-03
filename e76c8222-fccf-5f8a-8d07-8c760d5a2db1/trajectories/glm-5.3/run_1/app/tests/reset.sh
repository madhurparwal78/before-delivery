#!/bin/sh
# Reset the app database to an unseeded state and restart the server.
cd /app
node -e "
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query(\"SELECT tablename FROM pg_tables WHERE schemaname='public'\");
  const tables = res.rows.map(r => '\"' + r.tablename + '\"').join(',');
  await pool.query('TRUNCATE ' + tables + ' CASCADE');
  await pool.end();
  console.log('database cleared');
})();
"
for i in 1 2 3 4 5 6 7 8 9 10; do
  alive=0
  for p in /proc/[0-9]*/cmdline; do
    if grep -qa "dist/server.js" "$p" 2>/dev/null; then
      pid=$(basename "$(dirname "$p")")
      alive=1
      if [ "$i" = "1" ]; then kill "$pid" 2>/dev/null; else kill -9 "$pid" 2>/dev/null; fi
    fi
  done
  if [ "$alive" = "0" ]; then break; fi
  sleep 1
done
node dist/server.js > /tmp/server.log 2>&1 &
for i in $(seq 1 30); do
  if curl -s -m 2 localhost:4173/api/health | grep -q ok; then break; fi
  sleep 0.5
done
curl -s localhost:4173/api/health
echo
curl -s -X DELETE http://mailpit:8025/api/v1/messages > /dev/null
echo "mailpit cleared"
