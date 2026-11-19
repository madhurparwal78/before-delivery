#!/bin/bash
# Run every suite in order with a clean slate.
cd /app
set -e
echo "===== API: core ====="
timeout 200 python3 scripts/e2e.py | tail -3
echo "===== API: waitlist, offers, pairs, SSE ====="
timeout 250 python3 scripts/e2e-waitlist.py | tail -3
echo "===== API: races ====="
timeout 200 python3 scripts/e2e-races.py | tail -3
echo "===== API: killbill ====="
timeout 200 python3 scripts/e2e-killbill.py | tail -3
echo "===== API: recovery ====="
timeout 150 python3 scripts/e2e-recovery.py | tail -3
echo "===== API: outage ====="
timeout 120 python3 scripts/e2e-outage.py | tail -3
echo "===== API: recovery offer ====="
timeout 150 python3 scripts/e2e-recovery-offer.py | tail -3
echo "===== Browser: guest ====="
timeout 250 python3 scripts/browser-guest.py | tail -3
echo "===== Browser: host ====="
timeout 250 python3 scripts/browser-host.py | tail -3
echo "===== Browser: live and keyboard ====="
timeout 250 python3 scripts/browser-live.py | tail -3
echo "===== Browser: motion and breakpoints ====="
timeout 250 python3 scripts/browser-motion.py | tail -3
echo "===== Browser: expiry and streams ====="
timeout 250 python3 scripts/browser-expiry.py | tail -3
echo "ALL SUITES DONE"
