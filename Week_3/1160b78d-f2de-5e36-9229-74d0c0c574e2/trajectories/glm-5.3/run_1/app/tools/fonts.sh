#!/bin/sh
# Bundles the three open-licence fonts into static/fonts during install.
# Each font comes from its published OFL-1.1 package; nothing is fetched at
# build or runtime.
set -e
cd "$(dirname "$0")/.."
mkdir -p static/fonts

fetch() {
  out="static/fonts/$1"
  [ -f "$out" ] && return 0
  url="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --max-time 30 -o "$out" "$url" && return 0
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 30 -O "$out" "$url" && return 0
  fi
  rm -f "$out"
  return 1
}

# Prefer locally installed copies when present.
for d in /usr/share/fonts /usr/local/share/fonts; do
  [ -d "$d" ] || continue
  find "$d" -type f \( -iname 'DarkerGrotesque*' -o -iname 'Lexend*' -o -iname 'ChivoMono*' \) \
    -exec cp -n {} static/fonts/ \; 2>/dev/null || true
done

BASE="https://raw.githubusercontent.com/google/fonts/main/ofl"
fetch "DarkerGrotesque.ttf" "$BASE/darkergrotesque/DarkerGrotesque%5Bwght%5D.ttf" || true
fetch "Lexend.ttf" "$BASE/lexend/Lexend%5Bwght%5D.ttf" || true
fetch "ChivoMono.ttf" "$BASE/chivomono/ChivoMono%5Bwght%5D.ttf" || true

ls static/fonts || true
