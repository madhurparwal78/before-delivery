#!/bin/sh
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p /app
cp -R "$SOURCE/app/." /app/
# git drops empty folders; IF-07 needs these two at the app root, empty
mkdir -p /app/.browser_screenshots /app/.downloads
