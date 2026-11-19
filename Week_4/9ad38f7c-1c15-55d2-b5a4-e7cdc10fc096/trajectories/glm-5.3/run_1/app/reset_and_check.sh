#!/bin/sh
# Reset the database, restart one instance, run the API checks.
set -e
cd /app
for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  if tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -q "python -m server"; then
    kill $p 2>/dev/null || true
  fi
done
sleep 1
.venv/bin/python -c "
from server import db
try:
    conn = db.connect()
    cur = conn.cursor()
    for table in ('sessions','flag_attempts','login_attempts','webinar_claims','completions','team_solves','memberships','teams','users','scenarios','config'):
        cur.execute('DROP TABLE IF EXISTS ' + table + ' CASCADE')
    cur.execute('COMMIT')
    conn.close()
    print('database reset')
except Exception as exc:
    print('reset skipped:', exc)
" || true
rm -f /tmp/server1.log
(. .venv/bin/activate && exec python -m server --host 0.0.0.0 --port 4173 > /tmp/server1.log 2>&1 &)
sleep 4
.venv/bin/python check_api.py
