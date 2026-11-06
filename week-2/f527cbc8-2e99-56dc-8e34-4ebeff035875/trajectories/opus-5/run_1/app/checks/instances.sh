#!/bin/sh
# Serves the same build as the extra grading instances on later ports.
cd /app
APP_PUBLIC_PORT=4183 INSTANCE_LABEL=peer node dist/server/index.js > /tmp/peer.log 2>&1 &
APP_PUBLIC_PORT=4184 INSTANCE_LABEL=fast-clock DUNNING_DAY_SECONDS=2 JOB_BACKOFF_BASE_SECONDS=1 \
  JOB_LEASE_SECONDS=3 WAITLIST_OFFER_SECONDS=6 REMINDER_SCAN_SECONDS=2 IDEMPOTENCY_LEASE_SECONDS=3 \
  BOOKING_HOLD_SECONDS=15 node dist/server/index.js > /tmp/fast.log 2>&1 &
APP_PUBLIC_PORT=4185 INSTANCE_LABEL=killbill-down KILLBILL_URL=http://127.0.0.1:9 \
  VET_LINK_TTL_SECONDS=20 BOOKING_HOLD_SECONDS=15 node dist/server/index.js > /tmp/kbdown.log 2>&1 &
APP_PUBLIC_PORT=4186 INSTANCE_LABEL=mailpit-down SMTP_HOST=127.0.0.1 SMTP_PORT=9 \
  node dist/server/index.js > /tmp/maildown.log 2>&1 &
sleep 8
for port in 4183 4184 4185 4186; do
  printf "%s %s\n" "$port" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/healthz)"
done
