#!/bin/sh
# Stop any running server started for local checks.
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  if [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'bin/server'; then
    kill "$pid" 2>/dev/null || true
  fi
done
sleep 1
