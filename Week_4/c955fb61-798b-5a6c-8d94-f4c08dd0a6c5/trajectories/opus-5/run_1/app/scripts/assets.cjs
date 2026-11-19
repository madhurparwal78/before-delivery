const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, '..', 'dist', 'public');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'src', 'client', 'app.css'), path.join(out, 'app.css'));

const fontDir = path.join(__dirname, '..', 'node_modules', '@fontsource', 'stix-two-text', 'files');
for (const file of [
  'stix-two-text-latin-400-normal.woff2',
  'stix-two-text-latin-500-normal.woff2',
  'stix-two-text-latin-400-italic.woff2',
  'stix-two-text-latin-500-italic.woff2',
]) {
  fs.copyFileSync(path.join(fontDir, file), path.join(out, 'fonts', file));
}
