#!/bin/sh
# DP-53: several copies starting at the same moment each apply the schema and the starting
# data to their own data alone, and each creates its own bucket when it is missing.
set -e
cd /app
npm run build >/dev/null
node scripts/reset.mjs >/dev/null

STAMP=$(date +%s)
PORTS="4201 4202 4203"

for PORT in $PORTS; do
  S3_BUCKET="${S3_BUCKET}-start${STAMP}-${PORT}" APP_PUBLIC_PORT="$PORT" \
    APP_PUBLIC_URL="http://127.0.0.1:$PORT" \
    node dist/server.js > "/tmp/startup-$PORT.log" 2>&1 &
done

sleep 12

STATUS=0
for PORT in $PORTS; do
  HEALTH=$(curl -s "http://127.0.0.1:$PORT/api/health" || echo "")
  if [ "$HEALTH" = '{"status":"ok"}' ]; then
    echo "ok   copy on $PORT is serving"
  else
    echo "FAIL copy on $PORT is not serving: $HEALTH"
    STATUS=1
  fi
done

PIECES=$(curl -s "http://127.0.0.1:4201/api/rail" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pieces.length))")
if [ "$PIECES" = "6" ]; then
  echo "ok   the starting data was applied exactly once (6 pieces on the rail)"
else
  echo "FAIL the rail holds $PIECES pieces, expected 6"
  STATUS=1
fi

COUNTS=$(node -e "
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const rows = {};
  for (const table of ['members', 'consignors', 'ladders', 'pieces', 'sales', 'shop_state']) {
    const result = await pool.query('SELECT count(*)::int AS n FROM ' + table);
    rows[table] = result.rows[0].n;
  }
  await pool.end();
  console.log(JSON.stringify(rows));
})();
")
echo "     rows: $COUNTS"
EXPECTED='{"members":4,"consignors":4,"ladders":1,"pieces":12,"sales":3,"shop_state":1}'
if [ "$COUNTS" = "$EXPECTED" ]; then
  echo "ok   exactly the published starting data, no duplicates"
else
  echo "FAIL expected $EXPECTED"
  STATUS=1
fi

for PORT in $PORTS; do
  kill %1 2>/dev/null || true
done
pkill -f "node dist/server.js" 2>/dev/null || true
exit $STATUS
