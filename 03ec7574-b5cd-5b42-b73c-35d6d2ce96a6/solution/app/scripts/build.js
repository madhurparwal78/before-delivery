// Production build: fingerprinted assets in public/build and a manifest the server reads.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const out = path.join(root, 'public', 'build');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const widths = Array.from({ length: 101 }, (_, i) => `.w-${i}{width:${i}%}`).join('');
const sources = {
  'site.css': (text) => text.replace('/* @@WIDTHS@@ */', widths),
  'head.js': (text) => text,
  'app.js': (text) => text,
};

const manifest = {};
for (const [name, transform] of Object.entries(sources)) {
  const dir = name.endsWith('.css') ? 'css' : 'js';
  const text = transform(fs.readFileSync(path.join(root, 'public', dir, name), 'utf8'));
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);
  const file = name.replace(/\.(\w+)$/, `.${hash}.$1`);
  fs.writeFileSync(path.join(out, file), text);
  manifest[name] = file;
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`built ${Object.keys(manifest).length} assets`);
