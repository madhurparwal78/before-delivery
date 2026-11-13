#!/usr/bin/env bash
# Checks TMX imports, source locale uploads and audit retention.
set -u
BASE=${BASE:-http://localhost:4173}
JAR=/tmp/desk-cookies
P="$BASE/api/projects/larkspur-rider"
J='Content-Type: application/json'
say() { printf '\n== %s\n' "$1"; }

curl -s -c "$JAR" -X POST "$BASE/api/session" -H "$J" \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null

cat > /tmp/legacy.tmx <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <body>
    <tu>
      <tuv xml:lang="en"><seg>Privacy</seg></tuv>
      <tuv xml:lang="de-DE"><seg>Daten<bpt i="1">&lt;b&gt;</bpt>schutz<ept i="1">&lt;/b&gt;</ept></seg></tuv>
      <tuv xml:lang="fr"><seg>Confidentialité</seg></tuv>
    </tu>
    <tu>
      <tuv xml:lang="en"><seg>  SHIPPING  </seg></tuv>
      <tuv xml:lang="de"><seg>Versand</seg></tuv>
    </tu>
    <tu>
      <tuv xml:lang="en"><seg>Only source</seg></tuv>
      <tuv xml:lang="de"><seg></seg></tuv>
    </tu>
    <tu>
      <tuv xml:lang="en"><seg>Unknown target</seg></tuv>
      <tuv xml:lang="zu"><seg>Akwaziwa</seg></tuv>
    </tu>
    <tu>
      <tuv xml:lang="de"><seg>Kein Quelltext</seg></tuv>
      <tuv xml:lang="fr"><seg>Pas de source</seg></tuv>
    </tu>
  </body>
</tmx>
XML

say "tmx import"
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=tmx' -F 'file=@/tmp/legacy.tmx;type=application/xml'

say "entries now hold the de-DE row as de, with inline text joined"
curl -s -b "$JAR" "$P/tm?q=privacy"

say "shipping matched the main key despite case and spacing"
curl -s -b "$JAR" "$P/branches/main/keys?lang=de" | python3 -c '
import sys, json
for k in json.load(sys.stdin)["keys"]:
    if k["name"] in ("checkout.shipping", "settings.privacy"):
        print(k["name"], json.dumps(k["translations"]["de"]))'

say "re-importing the same TMX adds nothing"
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=tmx' -F 'file=@/tmp/legacy.tmx;type=application/xml' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("added",d["added"],"duplicates",d["duplicates"],"applied",d["applied"])'

say "unreadable tmx"
printf '<tmx><body><tu>' > /tmp/broken.tmx
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=tmx' -F 'file=@/tmp/broken.tmx;type=application/xml'

say "bad csv header"
printf 'a,b,c\n1,2,3\n' > /tmp/bad.csv
curl -s -b "$JAR" -X POST "$P/tm/imports" -F 'format=csv' -F 'file=@/tmp/bad.csv;type=text/csv'

say "source locale upload on a branch"
cat > /tmp/source.json <<'JSON'
{
  "nav": { "home": "Home", "settings": "Settings" },
  "checkout": { "total": "  Total: {amount}  " },
  "legal.terms": "Terms of service"
}
JSON
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fcheckout-redesign/source-files" \
  -F 'file=@/tmp/source.json;type=application/json'

say "download the source original byte for byte"
FILE_ID=$(curl -s -b "$JAR" "$P/source-files" | python3 -c 'import sys,json;print(json.load(sys.stdin)["files"][0]["file_id"])')
curl -s -b "$JAR" -D /tmp/headers -o /tmp/source.back "$P/source-files/$FILE_ID/original"
cmp /tmp/source.json /tmp/source.back && echo "identical"
grep -i -E 'content-type|content-disposition' /tmp/headers

say "nested arrays and non-string leaves are rejected"
printf '{"a":{"b":[1,2]}}' > /tmp/bad.json
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fcheckout-redesign/source-files" \
  -F 'file=@/tmp/bad.json;type=application/json'
printf '{"a":1}' > /tmp/bad2.json
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fcheckout-redesign/source-files" \
  -F 'file=@/tmp/bad2.json;type=application/json'
printf '{"a":"x","a":"y"}' > /tmp/bad3.json
curl -s -b "$JAR" -X POST "$P/branches/feature%2Fcheckout-redesign/source-files" \
  -F 'file=@/tmp/bad3.json;type=application/json'

say "audit retention: a copy with a one-second window shows nothing"
APP_PUBLIC_PORT=4274 AUDIT_RETENTION_SECONDS=1 ./bin/interline-desk > /tmp/desk-retention.log 2>&1 &
sleep 4
curl -s -c /tmp/jr -X POST http://localhost:4274/api/session -H "$J" \
  -d '{"email":"robin@marlowquill.example","password":"interline-demo-2026"}' > /dev/null
sleep 2
curl -s -b /tmp/jr http://localhost:4274/api/audit | head -c 200
echo
curl -s -b /tmp/jr http://localhost:4274/api/audit.csv | head -3
for p in /proc/[0-9]*; do
  if grep -qa bin/interline-desk $p/cmdline 2>/dev/null && grep -qa 'APP_PUBLIC_PORT=4274' $p/environ 2>/dev/null; then
    kill ${p#/proc/}
  fi
done
echo
