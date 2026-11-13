#!/usr/bin/env bash
# Smoke-checks the desk API against the running local stack.
set -u
BASE=${BASE:-http://localhost:4173}
JAR=/tmp/desk-cookies
say() { printf '\n== %s\n' "$1"; }

say "sign in"
curl -s -c "$JAR" -X POST "$BASE/api/session" -H 'Content-Type: application/json' \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}'

say "workspace stats"
curl -s -b "$JAR" "$BASE/api/workspace/stats"

say "project"
curl -s -b "$JAR" "$BASE/api/projects/larkspur-rider" | head -c 700

say "main preview"
curl -s -b "$JAR" "$BASE/api/projects/larkspur-rider/branches/main/merge-preview"

say "branch preview"
curl -s -b "$JAR" "$BASE/api/projects/larkspur-rider/branches/feature%2Fcheckout-redesign/merge-preview"

say "audit"
curl -s -b "$JAR" "$BASE/api/audit"
echo
