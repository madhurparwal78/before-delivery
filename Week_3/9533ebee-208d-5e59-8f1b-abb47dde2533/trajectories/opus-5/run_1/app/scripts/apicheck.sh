#!/bin/sh
# Reseeds, restarts and runs one API suite.
# Usage: apicheck.sh <suite.mjs> [ENV=value ...]
set -e
cd "$(dirname "$0")/.."
suite="$1"
shift
./scripts/reset.sh "$@" >/dev/null
node "$suite"
