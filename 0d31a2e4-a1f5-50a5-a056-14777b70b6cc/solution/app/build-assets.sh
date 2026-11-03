#!/bin/sh
# Copies the page, the stylesheet and the self-hosted fonts next to the bundled script.
set -e
mkdir -p dist/public/assets dist/public/fonts
cp client/index.html dist/public/index.html
cp client/styles.css dist/public/assets/app.css
for file in \
  bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2 \
  bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2 \
  atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2 \
  atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2 \
  atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2 \
  atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-700-normal.woff2
do
  cp "node_modules/@fontsource/$file" dist/public/fonts/
done
