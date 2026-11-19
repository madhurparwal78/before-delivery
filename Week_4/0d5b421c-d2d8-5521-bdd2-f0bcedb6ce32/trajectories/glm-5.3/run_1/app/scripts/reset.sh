#!/bin/bash
# Kill every app server, clean all test data, rebuild, and leave a clean slate.
cd /app
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null || true)
  case "$cmd" in
    *dist/server/main.js*) kill -9 "$pid" 2>/dev/null || true ;;
  esac
done
sleep 1
python3 -c "
import pg8000.native as pg
c = pg.Connection('gf_app', host='postgres', port=5432, database='gf_dev', password='gf-app-dev-2b7d41')
for t in ['offers','waitlist_entries','holds','bookings','outbox_emails','idempotency_records','host_sessions','pending_freed_tables','pending_events']:
    try: c.run(f'DROP TABLE IF EXISTS {t} CASCADE')
    except Exception as e: print(t, e)
"
python3 -c "
import redis
r = redis.Redis.from_url('redis://app:gfkit-dev@valkey:6379/0')
keys = list(r.scan_iter('*'))
if keys: r.delete(*keys)
print('valkey cleaned:', len(keys))
"
curl -s -m 5 -X DELETE http://mailpit:8025/api/v1/messages -o /dev/null
npm run build > /dev/null 2>&1
echo "ready"
