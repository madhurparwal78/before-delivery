// One express app: the pages, the /api prefix, the admin sub-router and the static assets.
// Every /console page is served on the session cookie set at sign in.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { pool, uid } = require('./store');
const { attachSession } = require('./api');
const { router: apiRouter } = require('./api');
const { router: adminRouter } = require('./admin');
const pages = require('./pages');
const { SESSION_COOKIE } = require('./helpers');

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '..', 'static'), { index: false, maxAge: '1h' }));

  // Attach the session (cookie or bearer) without refusing; the API decides per route.
  app.use(attachSession);

  // An administration write whose content type is anything other than application/json is
  // refused 415 naming content_type and records nothing.
  app.use('/api/admin', (req, res, next) => {
    const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!write) return next();
    const ct = String(req.headers['content-type'] || '');
    if (ct && !ct.includes('application/json')) {
      return res.status(415).json({ reason: 'That request body type is not supported.', field: 'content_type' });
    }
    next();
  });

  app.use('/api/admin', adminRouter);

  // JSON body parses are the interface calls; a malformed JSON body answers 422 naming body.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(422).json({ reason: 'A request body must be JSON.', field: 'body' });
    }
    next(err);
  });

  app.use('/api/admin', adminRouter);
  app.use('/api', apiRouter);

  // The console and public pages.
  app.use('/', pages.router);

  // The custom not-found page for any address with no route.
  app.use((req, res) => {
    res.status(404).type('text/html').send(pages.notFoundPage());
  });

  // A server error never reaches the reader as a refusal shape.
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ reason: 'Something went wrong on our side.', field: 'server' });
  });

  return app;
}

module.exports = { buildApp };
