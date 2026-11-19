#!/bin/bash
# Development helper: stop, start or restart a built instance.
# `ps` and `pkill` are not available in this sandbox, so processes are found through /proc.
set -u

APP_DIR=/app
ENTRY=dist/server/main.js

find_pids() {
  local pattern="$1"
  for p in /proc/[0-9]*; do
    [ -r "$p/cmdline" ] || continue
    if tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q -- "$pattern"; then
      basename "$p"
    fi
  done
}

stop_all() {
  local pattern="${1:-$ENTRY}"
  for pid in $(find_pids "$pattern"); do
    kill "$pid" 2>/dev/null && echo "stopped $pid"
  done
  sleep 1
}

start_one() {
  local name="$1" port="$2"
  shift 2
  cd "$APP_DIR" || exit 1
  env "$@" INSTANCE_ID="$name" APP_PUBLIC_PORT="$port" PUBLIC_BASE_URL="http://127.0.0.1:$port" \
    node "$ENTRY" > "/tmp/server-$name.log" 2>&1 &
  echo "started instance $name on $port (log /tmp/server-$name.log)"
}

wait_health() {
  local port="$1"
  for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:$port/api/health" > /dev/null 2>&1; then
      echo "instance on $port is healthy"
      return 0
    fi
    sleep 0.5
  done
  echo "instance on $port did not become healthy"
  return 1
}

case "${1:-}" in
  stop) stop_all "${2:-$ENTRY}" ;;
  start) start_one "${2:-a}" "${3:-4173}" ; wait_health "${3:-4173}" ;;
  restart)
    stop_all
    start_one "${2:-a}" "${3:-4173}"
    wait_health "${3:-4173}"
    ;;
  *) echo "usage: dev.sh {stop|start|restart} [instance] [port]" ; exit 1 ;;
esac
