#!/bin/sh
# Run every end-to-end suite, resetting the server clock to real time between them
# because some suites move it.
set -e
cd /app
for suite in journeys manager contracts grading; do
  echo "=== $suite ==="
  node -e "
fetch('http://127.0.0.1:4173/api/grading/clock', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ set: new Date().toISOString() })
}).then((r) => r.json()).then((d) => console.log('clock reset to', d.now));
" > /dev/null 2>&1 || true
  node e2e/$suite.mjs 2>&1 | tail -2
done
