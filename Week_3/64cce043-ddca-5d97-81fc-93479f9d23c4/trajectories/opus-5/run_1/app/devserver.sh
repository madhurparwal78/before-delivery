#!/bin/sh
# Development helper: start, stop or restart the app on APP_PUBLIC_PORT.
# Not part of the shipped app.
cd /app || exit 1
stop() {
    for d in /proc/[0-9]*; do
        pid=${d#/proc/}
        cmd=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)
        case "$cmd" in *"python -m app"*) kill -9 "$pid" 2>/dev/null ;; esac
    done
    sleep 1
}
case "$1" in
    stop) stop ;;
    *)
        stop
        .venv/bin/python -m app > /tmp/server.log 2>&1 &
        for _ in $(seq 40); do
            sleep 0.5
            if curl -fsS localhost:"${APP_PUBLIC_PORT:-4173}"/api/health > /dev/null 2>&1; then
                echo "ready"
                exit 0
            fi
        done
        echo "not ready"
        tail -20 /tmp/server.log
        exit 1
        ;;
esac
