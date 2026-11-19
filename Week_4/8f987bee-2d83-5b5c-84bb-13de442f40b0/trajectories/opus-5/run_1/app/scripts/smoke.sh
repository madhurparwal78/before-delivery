#!/usr/bin/env bash
# A quick walk through the published interface against a running server.
set -u
BASE="http://localhost:${APP_PUBLIC_PORT:-4173}"

say() { printf '\n=== %s\n' "$1"; }
api() { curl -s -X "$1" "$BASE$2" -H "Content-Type: application/json" "${@:3}"; }

say "health"; curl -s "$BASE/api/health"
say "login editor"
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"editor@example.com","password":"deku-demo-pw-2026"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
echo "token: ${TOKEN:0:8}..."
AUTH=(-H "Authorization: Bearer $TOKEN")
say "me"; api GET /api/me "${AUTH[@]}"
say "workspace"; api GET /api/workspace "${AUTH[@]}"
say "stats"; api GET /api/stats "${AUTH[@]}"
say "connections"; api GET /api/connections "${AUTH[@]}"
say "definitions count"; api GET "/api/connector-definitions" "${AUTH[@]}" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["definitions"]))'
say "q=sql"; api GET "/api/connector-definitions?q=sql" | python3 -c 'import sys,json;print([d["name"] for d in json.load(sys.stdin)["definitions"]])'
say "q=pct"; api GET "/api/connector-definitions?q=%25" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["definitions"]))'
say "undefined path"; curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/nope"; api GET /api/nope
say "trailing slash"; curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/connections/"
say "method not allowed"; curl -s -i -X DELETE "$BASE/api/connections" | head -4
say "docs"; curl -s -o /dev/null -w '%{http_code}\n' "$BASE/docs"
