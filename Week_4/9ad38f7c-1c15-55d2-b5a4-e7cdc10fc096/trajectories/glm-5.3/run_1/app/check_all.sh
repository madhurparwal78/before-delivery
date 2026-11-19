#!/bin/sh
# Full verification: reset the database, start one instance, run every suite.
set -e
cd /app
sh reset_and_check.sh 2>&1 | grep -E "passed,|FAIL" || true
echo "--- races"
.venv/bin/python check_races.py 2>&1 | grep -E "passed,|FAIL" || true
echo "--- locks"
.venv/bin/python check_locks.py 2>&1 | grep -E "passed,|FAIL" || true
echo "--- outage"
.venv/bin/python check_outage.py 2>&1 | grep -E "passed,|FAIL" || true
echo "--- browser"
timeout 170 python3 check_browser.py 2>&1 | grep -E "passed,|FAIL" || true
