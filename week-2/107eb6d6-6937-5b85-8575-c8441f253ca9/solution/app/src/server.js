'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const nunjucks = require('nunjucks');
const config = require('./config');
const { migrate, readiness } = require('./db');
const { seed } = require('./seed');
const { LABELS } = require('./messages');
const api = require('./api');
const pages = require('./pages');

const root = path.resolve(__dirname, '..');
const staticUrls = JSON.parse(fs.readFileSync(path.join(root, 'build', 'static.json'), 'utf8'));

const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple');
app.set('view engine', 'njk');

const views = nunjucks.configure(path.join(root, 'views'), { autoescape: true, express: app });
views.addGlobal('asset', (name) => staticUrls[name]);
views.addGlobal('LABELS', LABELS);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Calendar dates (YYYY-MM-DD) read as written; timestamps are shown in UTC.
views.addFilter('day', (value) => {
  if (!value) return '';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
});
views.addFilter('stamp', (value) => {
  const t = new Date(value);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${hh}:${mm} UTC`;
});
views.addFilter('trucks', (n, word) => `${n} ${n === 1 ? 'truck' : 'trucks'} ${word}`);
// Split a display headline into lines of about `width` characters, word by word.
views.addFilter('lines', (sentence, width) => {
  const out = [];
  for (const word of String(sentence).split(/\s+/).filter(Boolean)) {
    const last = out.length - 1;
    if (last >= 0 && out[last].length + 1 + word.length <= width) out[last] = `${out[last]} ${word}`;
    else out.push(word);
  }
  return out;
});

app.use('/static', express.static(path.join(root, 'public'), { maxAge: '365d', immutable: true, index: false }));
app.use('/api', api);
app.use('/', pages);

// Apply the schema and the seed, retrying until PostgreSQL answers; the server
// listens from the start and reports ok on health only once this is done.
async function prepare() {
  try {
    await migrate();
    await seed();
    readiness.ready = true;
    process.stdout.write('gigfreight records ready\n');
  } catch (err) {
    process.stdout.write(`gigfreight waiting for PostgreSQL: ${err.message}\n`);
    setTimeout(prepare, 3000);
  }
}

app.listen(config.listenPort, config.listenHost, () => {
  process.stdout.write(`gigfreight listening on ${config.listenHost}:${config.listenPort}\n`);
  prepare();
});

process.on('SIGTERM', () => process.exit(0));
