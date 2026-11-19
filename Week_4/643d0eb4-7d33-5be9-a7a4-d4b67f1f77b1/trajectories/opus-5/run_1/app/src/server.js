'use strict';
const path = require('path');
const express = require('express');
const core = require('./core');
const authModule = require('./auth');
const api = require('./api');
const admin = require('./admin');
const routes = require('./routes');
const pub = require('./pages_public');
const { runSeed } = require('./seed');

const PORT = Number(process.env.APP_PUBLIC_PORT || 4173);

const app = express();
app.disable('x-powered-by');
app.set('etag', false);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

/** A multipart form post is a form post, so its text fields are read too. */
app.use(function (req, res, next) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('multipart/form-data')) return next();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', function () {
    const raw = Buffer.concat(chunks).toString('utf8');
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    const body = {};
    if (boundaryMatch) {
      const boundary = '--' + (boundaryMatch[1] || boundaryMatch[2]).trim();
      for (const part of raw.split(boundary)) {
        const nameMatch = /name="([^"]*)"/.exec(part);
        if (!nameMatch) continue;
        const split = part.indexOf('\r\n\r\n');
        if (split === -1) continue;
        body[nameMatch[1]] = part.slice(split + 4).replace(/\r\n$/, '');
      }
    }
    req.body = body;
    next();
  });
  req.on('error', next);
});

app.use(authModule.sessionMiddleware());

app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    fallthrough: true,
  })
);

app.use('/api/admin', admin.router);
app.use('/api', api.router);

// An unknown address under /api is a JSON refusal, not a page.
app.use('/api', function (req, res) {
  res.status(404).json({ reason: 'That address is not part of Keystone Tables.', field: 'path' });
});

app.use(routes.router);

// Any address with no route answers the custom not-found page.
app.use(
  routes.wrap(async function (req, res) {
    const ctx = await routes.baseContext(req);
    routes.sendPage(res, 404, pub.notFound(ctx));
  })
);

app.use(async function (err, req, res, next) {
  if (res.headersSent) return next(err);
  const isApi = req.path.startsWith('/api');
  if (err instanceof core.Refusal) {
    if (isApi) return res.status(err.status).json(err.body);
    let ctx;
    try {
      ctx = await routes.baseContext(req);
    } catch {
      ctx = { auth: null, path: req.path, isSteward: false, grants: [] };
    }
    if (err.field === 'department' && err.status === 403) {
      ctx.department = String(err.reason).replace(/^.*: /, '').replace(/\.$/, '');
      return routes.sendPage(res, 403, pub.departmentRefusal(ctx));
    }
    if (err.status === 401) return routes.sendPage(res, 401, pub.sessionRefusal(ctx));
    if (err.status === 404) return routes.sendPage(res, 404, pub.notFound(ctx));
    return routes.sendPage(res, err.status, pub.sessionRefusal(ctx));
  }
  if (err && err.type === 'entity.parse.failed') {
    if (isApi) return res.status(422).json({ reason: 'That request body is not readable.', field: 'body' });
  }
  console.error(err);
  if (isApi) return res.status(500).json({ reason: 'Something went wrong.', field: 'server' });
  let ctx;
  try {
    ctx = await routes.baseContext(req);
  } catch {
    ctx = { auth: null, path: req.path, isSteward: false, grants: [] };
  }
  return routes.sendPage(res, 500, pub.notFound(ctx));
});

async function start() {
  await runSeed();
  app.listen(PORT, '0.0.0.0', function () {
    console.log(`Keystone Tables listening on 0.0.0.0:${PORT}`);
  });
}

start().catch(function (err) {
  console.error('Failed to start', err);
  process.exit(1);
});
