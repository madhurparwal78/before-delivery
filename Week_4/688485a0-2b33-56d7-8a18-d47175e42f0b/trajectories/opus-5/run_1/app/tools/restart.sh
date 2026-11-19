#!/usr/bin/env bash
set -u
cd /app
node -e '
const fs = require("fs");
for (const entry of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(entry) || entry === String(process.pid)) continue;
  let cmd = "";
  try { cmd = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8"); } catch { continue; }
  if (cmd.includes("dist/server/index.js")) {
    try { process.kill(Number(entry), "SIGTERM"); console.log("stopped", entry); } catch {}
  }
}
'
sleep 1
npm run build > /tmp/build.log 2>&1 || { tail -20 /tmp/build.log; exit 1; }
nohup node dist/server/index.js > /tmp/server.log 2>&1 &
sleep 2
curl -s localhost:4173/api/health
echo
