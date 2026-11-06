#!/bin/sh
# Stops every instance of the build and waits for the ports to come free, because a
# draining instance keeps listening until its grace period is nearly up.
for pid in /proc/[0-9]*; do
  p=$(basename "$pid")
  if [ -r "/proc/$p/cmdline" ] && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "dist/server/index.js"; then
    kill "$p" 2>/dev/null && echo "stopped $p"
  fi
done
for attempt in $(seq 1 40); do
  busy=0
  for port in 4173 4183 4184 4185 4186 4190; do
    if curl -s -m 1 -o /dev/null "http://127.0.0.1:$port/healthz" 2>/dev/null; then busy=1; fi
  done
  [ "$busy" = "0" ] && break
  sleep 1
done
