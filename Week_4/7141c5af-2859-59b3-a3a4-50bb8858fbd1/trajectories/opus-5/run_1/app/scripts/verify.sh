#!/bin/sh
# The whole verification suite. Suites that read the pristine seed run straight
# after a reseed, because the API probe deliberately writes to it.
# Verification only.
set -e
cd "$(dirname "$0")/.."

echo "### typecheck"
npx tsc --noEmit

echo
echo "### licences"
node scripts/notices.mjs

echo
echo "### domain rules"
node scripts/run-ts.mjs scripts/domain-checks.ts

echo
echo "### fresh primary copy"
sh scripts/restart.sh --fresh

echo
echo "### browser journeys, on the pristine seed"
python3 scripts/browser.py

echo
echo "### accessibility and screen rules"
python3 scripts/axe.py

echo
echo "### pages"
python3 scripts/pages.py

echo
echo "### published details"
python3 scripts/details.py

echo
echo "### fresh primary copy"
sh scripts/restart.sh --fresh

echo
echo "### API"
python3 scripts/probe.py

echo
echo "### the other copies"
sh scripts/copies.sh storage 4181
sh scripts/copies.sh render 4182
sh scripts/copies.sh search 4183
sh scripts/copies.sh short 4184
sh scripts/copies.sh session 4185
sh scripts/copies.sh spare 4186
python3 scripts/degraded.py

echo
echo "### final sweep"
python3 scripts/sweep.py

echo
echo "### all suites passed"
