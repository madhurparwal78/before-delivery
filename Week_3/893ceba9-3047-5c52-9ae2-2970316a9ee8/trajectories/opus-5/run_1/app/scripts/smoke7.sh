#!/usr/bin/env bash
# Checks that several instances booting at once write the seed exactly once,
# and that erasing a project removes its Svix application.
set -u
cd /app
J='Content-Type: application/json'
say() { printf '\n== %s\n' "$1"; }

say "three instances boot at once against an empty database"
/tmp/reset/reset > /dev/null
for port in 4281 4282 4283; do
  APP_PUBLIC_PORT=$port ./bin/interline-desk > "/tmp/desk-$port.log" 2>&1 &
done
sleep 6
for port in 4281 4282 4283; do
  printf '%s health: %s\n' "$port" "$(curl -s http://localhost:$port/api/health)"
done
curl -s -c /tmp/j7 -X POST http://localhost:4281/api/session -H "$J" \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null
curl -s -b /tmp/j7 http://localhost:4281/api/workspace/stats
echo
curl -s -b /tmp/j7 http://localhost:4281/api/audit | python3 -c '
import sys, json
entries = json.load(sys.stdin)["entries"]
print("audit entries:", len(entries), [e["action"] for e in entries])'
curl -s -b /tmp/j7 http://localhost:4281/api/projects | python3 -c '
import sys, json
print("projects:", len(json.load(sys.stdin)["projects"]))'

say "erasing a project deletes its Svix application"
PROJECT=$(curl -s -b /tmp/j7 -X POST http://localhost:4281/api/projects -H "$J" \
  -d '{"slug":"erase-me","name":"Erase Me","client":"Nobody","source_language":"en","target_languages":["de"],"repository":"nobody/app"}')
PID=$(echo "$PROJECT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -b /tmp/j7 -X PUT http://localhost:4281/api/projects/erase-me/webhook -H "$J" \
  -d '{"url":"https://ci.example.test/hooks/erase"}' > /dev/null
printf 'application before: %s\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SVIX_API_KEY" \
     "$SVIX_URL/api/v1/app/idk-$PID/")"
curl -s -b /tmp/j7 -X DELETE http://localhost:4281/api/projects/erase-me -H "$J" -d '{"confirm":"erase-me"}'
printf 'application after: %s\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SVIX_API_KEY" \
     "$SVIX_URL/api/v1/app/idk-$PID/")"
printf 'project after: %s\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/j7 http://localhost:4281/api/projects/erase-me)"
curl -s -b /tmp/j7 http://localhost:4281/api/audit | python3 -c '
import sys, json
entries = json.load(sys.stdin)["entries"]
print("newest entries:", [(e["action"], e["actor"], e["project"], e["detail"]) for e in entries[:2]])'

for port in 4281 4282 4283; do
  for p in /proc/[0-9]*; do
    if grep -qa bin/interline-desk $p/cmdline 2>/dev/null && grep -qa "APP_PUBLIC_PORT=$port" $p/environ 2>/dev/null; then
      kill ${p#/proc/}
    fi
  done
done
echo
