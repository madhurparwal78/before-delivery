'use strict';

const path = require('path');
const express = require('express');
const { pool } = require('./lib/db');
const { applySchemaAndSeed } = require('./lib/schema');
const auth = require('./lib/auth');
const { Store } = require('./lib/repository');
const api = require('./server/api');
const pages = require('./server/pages');
const fragments = require('./server/fragments');

const store = new Store(pool);
const app = express();
app.disable('x-powered-by');

const BODY_LIMIT = 100000;

// JSON bodies for the API, with the shared byte limit and error mapping.
app.use(express.json({
  limit: BODY_LIMIT,
  type: ['application/json'],
  strict: true,
}));

// The session cookie is the only state the browser holds.
const COOKIE_NAME = 'gf_session';
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: false }));

// A tiny same-origin cookie reader; nothing here reaches the browser.
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index > -1) {
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key) req.cookies[key] = decodeURIComponent(value);
      }
    }
  }
  next();
});

app.use((req, res, next) => {
  res.locals.publicUrl = process.env.APP_PUBLIC_URL || `http://127.0.0.1:${process.env.APP_PUBLIC_PORT || 4173}`;
  next();
});

// Same-origin write guard: a page or fragment write whose Origin header names
// another origin is refused with 403.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
    let originHost = null;
    try { originHost = new URL(req.headers.origin).host; } catch { originHost = null; }
    if (!originHost || originHost !== req.headers.host) {
      return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this page.' });
    }
  }
  next();
});

// Anything under /api authenticates by the bearer header only.
app.use('/api', (req, res, next) => {
  req.authMode = 'bearer';
  next();
});

const markSchemaApiApplied = api.mount(app, { pool, store, auth });

// Browser pages and fragments authenticate by the session cookie.
app.use((req, res, next) => {
  req.authMode = 'cookie';
  next();
});

pages.mount(app, { pool, store, auth, cookieName: COOKIE_NAME, fragments });

// Static assets from the app's own origin only.
app.use('/static', express.static(path.join(__dirname, 'public'), {
  fallthrough: true,
  maxAge: '1h',
}));
// No route answered: the not-found page.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found' });
  }
  return pages.renderNotFound(req, res);
});

// Error precedence at the boundary: 413 and 415 from the body readers, then
// malformed JSON as 400, then the shared 503 for an unreachable database.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ error: 'too_large', message: 'Request body is too large.' });
    }
    if (err && err.status === 415) {
      return res.status(415).json({ error: 'unsupported_media_type', message: 'Send the body as application/json.' });
    }
    if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
      return res.status(400).json({ error: 'bad_request', message: 'Request body is not valid JSON.' });
    }
    if (err && err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'unavailable', message: 'The desk cannot reach its records right now. Try again shortly.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal_error' });
  }
  console.error(err);
  return pages.renderUnavailable(req, res);
});

const schemaState = { applied: false };

async function ensureSchema() {
  await applySchemaAndSeed(pool, auth.hashPassword, schemaState);
}

async function start() {
  const port = Number(process.env.APP_PUBLIC_PORT) || 4173;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Gigfreight dispatch desk listening on 0.0.0.0:${port}`);
  });
  const retry = () => ensureSchema()
    .then(() => {
      console.log('schema and seed applied');
      markSchemaApiApplied();
    })
    .catch((err) => {
      console.log(`database not ready (${err.message}); retrying`);
      setTimeout(retry, 3000);
    });
  retry();
}

module.exports = { app, start, ensureSchema, pool };

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
