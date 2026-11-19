#!/bin/sh
cd /app || exit 1
for dir in /proc/[0-9]*; do
  if grep -qa 'dist/server/index.js' "$dir/cmdline" 2>/dev/null; then
    kill "$(basename "$dir")" 2>/dev/null
  fi
done
sleep 1
npm run build 2>&1 | grep -E 'error|warning' && exit 1
node -e "
const pg=require('pg');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;').then(()=>pool.end());
" || exit 1
sh scripts/dev.sh > /tmp/server.log 2>&1 &
sleep 4
curl -s -X POST localhost:4173/api/grading/setup -H 'content-type: application/json' \
  -H 'X-Grading-Key: test-key' --data-binary @scripts/seed.json > /tmp/setup.json
echo "restarted"
