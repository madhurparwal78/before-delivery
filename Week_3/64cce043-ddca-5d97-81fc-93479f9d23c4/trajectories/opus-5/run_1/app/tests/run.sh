#!/bin/sh
# Development helper: every check, each against a freshly seeded database and realm.
set -e
cd /app/tests

step() {
    echo
    echo "=== $1 ==="
}

unset GRANT_HOUR_SECONDS SESSION_IDLE_SECONDS

step "API"
/app/tests/reset.sh > /dev/null
/app/.venv/bin/python api_check.py

step "races and live streams"
/app/tests/reset.sh > /dev/null
/app/.venv/bin/python concurrency_check.py

step "sign-in, provisioning and isolation"
/app/tests/reset.sh > /dev/null
/app/.venv/bin/python auth_check.py

step "identity outage"
/app/tests/reset.sh > /dev/null
/app/.venv/bin/python outage_check.py

step "browser: screens and journeys"
/app/tests/reset.sh > /dev/null
npx playwright test ui.spec.js

step "browser: reorder, stale edits, dialogs"
/app/tests/reset.sh > /dev/null
npx playwright test ui2.spec.js

step "browser: draft after an expired session"
SESSION_IDLE_SECONDS=20 /app/tests/reset.sh > /dev/null
npx playwright test draft.spec.js

step "grant expiry and idle sessions"
GRANT_HOUR_SECONDS=1 SESSION_IDLE_SECONDS=20 /app/tests/reset.sh > /dev/null
GRANT_HOUR_SECONDS=1 SESSION_IDLE_SECONDS=20 /app/.venv/bin/python timing_check.py

step "back to the published defaults"
/app/tests/reset.sh > /dev/null
echo "all checks finished"
