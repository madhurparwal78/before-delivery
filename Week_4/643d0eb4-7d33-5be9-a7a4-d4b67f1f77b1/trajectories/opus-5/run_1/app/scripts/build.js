'use strict';
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'files');
const dest = path.join(__dirname, '..', 'public', 'fonts');
fs.mkdirSync(dest, { recursive: true });

for (const weight of [400, 500, 600, 700]) {
  const name = `inter-latin-${weight}-normal.woff2`;
  const from = path.join(src, name);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(dest, name));
    console.log('copied', name);
  } else {
    console.warn('missing', name);
  }
}

for (const dir of ['.browser_screenshots', '.downloads']) {
  fs.mkdirSync(path.join(__dirname, '..', dir), { recursive: true });
}
console.log('build complete');
