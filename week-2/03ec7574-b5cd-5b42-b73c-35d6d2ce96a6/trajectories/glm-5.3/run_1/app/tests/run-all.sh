#!/bin/sh
# Full clean-suite run: fresh database, then every suite.
set -e
cd /app
echo "== stopping any running server =="
for p in /proc/[0-9]*; do
  if grep -q "server.js" $p/cmdline 2>/dev/null; then kill ${p#/proc/} 2>/dev/null || true; fi
done
sleep 1
echo "== resetting database =="
node --input-type=module -e "
import { poolRef } from './lib/db.js';
const c = await poolRef().connect();
await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
c.release(); await poolRef().end();
console.log('reset done');
"
echo "== starting server =="
(nohup npm start > /tmp/corvo.log 2>&1 &) 
for i in $(seq 1 20); do
  if curl -s http://127.0.0.1:4173/api/health | grep -q '"ok"'; then break; fi
  sleep 1
done
echo "== smoke =="
python3 tests/smoke.py
echo "== flows =="
python3 tests/flows.py
echo "== invariants =="
node tests/invariants.mjs
echo "== reseed for UI =="
for p in /proc/[0-9]*; do
  if grep -q "server.js" $p/cmdline 2>/dev/null; then kill ${p#/proc/} 2>/dev/null || true; fi
done
sleep 1
node --input-type=module -e "
import { poolRef } from './lib/db.js';
const c = await poolRef().connect();
await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
c.release(); await poolRef().end();
console.log('reset done');
"
(nohup npm start > /tmp/corvo.log 2>&1 &)
for i in $(seq 1 20); do
  if curl -s http://127.0.0.1:4173/api/health | grep -q '"ok"'; then break; fi
  sleep 1
done
echo "== ui =="
python3 tests/ui.py
echo "ALL SUITES PASSED"
