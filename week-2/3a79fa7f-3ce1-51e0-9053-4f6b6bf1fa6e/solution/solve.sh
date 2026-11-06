#!/bin/sh
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p /app
cp -R "$SOURCE/app/." /app/
mkdir -p /app/.browser_screenshots /app/.downloads
