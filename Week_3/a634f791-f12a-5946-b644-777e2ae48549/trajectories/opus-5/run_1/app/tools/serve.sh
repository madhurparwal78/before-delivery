#!/bin/sh
cd /app
for d in /proc/[0-9]*; do
  if grep -qa "gunicorn" "$d/cmdline" 2>/dev/null; then kill -9 "${d#/proc/}" 2>/dev/null; fi
done
sleep 1
nohup .venv/bin/gunicorn --config gunicorn.conf.py wsgi:app > /tmp/serve.log 2>&1 &
sleep 6
