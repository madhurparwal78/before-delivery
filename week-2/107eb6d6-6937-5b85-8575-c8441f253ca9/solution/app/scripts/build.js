'use strict';
// Production build: copy htmx from node_modules into public/ and fingerprint the
// static files so the server can send them with a long cache lifetime.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pub = path.join(root, 'public');
fs.mkdirSync(path.join(pub, 'vendor'), { recursive: true });
fs.copyFileSync(require.resolve('htmx.org/dist/htmx.min.js'), path.join(pub, 'vendor', 'htmx.min.js'));

const urls = {};
for (const name of ['app.css', 'app.js', 'vendor/htmx.min.js']) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(pub, name))).digest('hex');
  urls[name] = `/static/${name}?v=${digest.slice(0, 12)}`;
}
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'static.json'), `${JSON.stringify(urls, null, 2)}\n`);
process.stdout.write(`built ${Object.keys(urls).length} static files\n`);
