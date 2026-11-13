#!/bin/sh
# Reseeds, starts two server processes sharing the database, and runs a suite.
set -e
cd "$(dirname "$0")/.."
./scripts/reset.sh "$@" >/dev/null
node - <<'NODE'
import { spawn } from 'node:child_process';
const extra = {};
for (const pair of process.env.EXTRA_ENV?.split(' ') ?? []) {
  if (pair === '') continue;
  const i = pair.indexOf('=');
  extra[pair.slice(0, i)] = pair.slice(i + 1);
}
const child = spawn(process.execPath, ['/app/dist/server.js'], {
  env: { ...process.env, ...extra, APP_PUBLIC_PORT: '4174' },
  stdio: 'ignore',
  detached: true,
});
child.unref();
NODE
for i in $(seq 1 40); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4174/api/health)" = "200" ]; then
    echo "both processes ready"
    break
  fi
  sleep 0.5
done
