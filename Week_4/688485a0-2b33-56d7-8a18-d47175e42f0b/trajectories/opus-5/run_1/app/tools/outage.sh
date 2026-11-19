#!/usr/bin/env bash
set -u
cd /app
PORT=4199
S3_ENDPOINT=http://127.0.0.1:9 APP_PUBLIC_PORT=$PORT nohup node dist/server/index.js > /tmp/outage.log 2>&1 &
sleep 3
BASE="http://127.0.0.1:$PORT"
J='Content-Type: application/json'
echo -n "health: "; curl -s "$BASE/api/health"; echo
S=$(date +%s)
SEED=$(curl -s -X POST "$BASE/api/grading/seed" -H "$J" -H "X-Grading-Key: grade-7f3c" -d "{
  \"users\":[{\"email\":\"down$S@example.test\",\"password\":\"jarful-pass\",\"name\":\"Dana Down\"}],
  \"projects\":[{\"name\":\"Down $S\",\"owner\":\"down$S@example.test\",
    \"collections\":[{\"name\":\"stuff\",\"documents\":[{\"_id\":\"a00000000000000000000001\",\"a\":1}]}]}]}")
PID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Down $S']['id'])" "$SEED")
CID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['projects']['Down $S']['collections']['stuff']['id'])" "$SEED")
C="$BASE/api/projects/$PID/collections/$CID"
curl -s -c /tmp/d.jar -X POST "$BASE/api/auth/signin" -H "$J" -d "{\"email\":\"down$S@example.test\",\"password\":\"jarful-pass\"}" > /dev/null
echo -n "query still works: "; curl -s -b /tmp/d.jar -X POST "$C/query" -H "$J" -d '{}' | head -c 80; echo
echo -n "insert still works: "; curl -s -b /tmp/d.jar -X POST "$C/documents" -H "$J" -d '{"document":{"b":2}}' | head -c 60; echo
echo -n "import refused: "; printf '{"x":1}\n' | curl -s -b /tmp/d.jar -X POST "$C/imports?format=jsonl" -H 'X-File-Name: x.jsonl' --data-binary @-; echo
echo -n "import record state: "; curl -s -b /tmp/d.jar "$C/imports" | python3 -c "import json,sys;print([i['state'] for i in json.load(sys.stdin)['imports']])"
echo -n "export refused: "; curl -s -b /tmp/d.jar -X POST "$C/exports" -H "$J" -d '{"format":"jsonl","filter":{}}'; echo
node -e '
const fs = require("fs");
for (const entry of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(entry)) continue;
  let cmd = "";
  try { cmd = fs.readFileSync(`/proc/${entry}/environ`, "utf8"); } catch { continue; }
  if (cmd.includes("APP_PUBLIC_PORT=4199")) { try { process.kill(Number(entry), "SIGTERM"); console.log("stopped", entry); } catch {} }
}
'
