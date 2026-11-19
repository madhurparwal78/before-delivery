#!/bin/sh
# Start or stop a local instance for the checks: run_instance.sh start|stop [port]
set -u
PORT="${2:-4173}"
PIDFILE="/tmp/downtime-$PORT.pid"
cd /app || exit 1

stop_instance() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
  fi
  for proc in /proc/[0-9]*; do
    if tr "\000" " " < "$proc/cmdline" 2>/dev/null | grep -q -- "-m server .*--port $PORT"; then
      kill "$(basename "$proc")" 2>/dev/null
    fi
  done
}

case "$1" in
  start)
    stop_instance
    sleep 0.3
    .venv/bin/python -m server --host 127.0.0.1 --port "$PORT" \
      > "/tmp/downtime-$PORT.log" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 3
    ;;
  stop)
    stop_instance
    ;;
esac
