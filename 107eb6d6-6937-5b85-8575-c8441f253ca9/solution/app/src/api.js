'use strict';
// The JSON API under /api. Bearer tokens only; every refusal is an AppError body.
const express = require('express');
const { memberForToken, signIn, signOut } = require('./auth');
const {
  listRequests, getRequest, listActivity, dispatchBoard, listTrucks, listMembers, createRequest, assignTruck,
  releaseTruck, decide, setTruckStatus, setRole,
} = require('./desk');
const { query, readiness } = require('./db');
const { AppError, COPY, refuse } = require('./messages');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const hasBody = (req) => req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > 0;

// The server boundary: a body must be JSON, at most 100,000 bytes, and well formed.
router.use((req, res, next) => (hasBody(req) && !req.is('application/json') ? next(refuse.unsupportedMedia()) : next()));
router.use(express.json({ limit: 100000, type: 'application/json' }));
router.use((req, res, next) => {
  req.payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  next();
});

router.get('/health', wrap(async (req, res) => {
  if (!readiness.ready) return res.status(503).json({ status: 'unavailable' });
  try {
    await query('SELECT 1');
  } catch {
    return res.status(503).json({ status: 'unavailable' });
  }
  return res.json({ status: 'ok' });
}));

router.post('/auth/login', wrap(async (req, res) => {
  res.json(await signIn(req.payload.email, req.payload.password));
}));

// The member, with the role stored at this moment, loaded on every request.
const member = wrap(async (req, res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  req.token = match ? match[1] : null;
  req.member = await memberForToken(req.token);
  if (!req.member) throw refuse.unauthenticated();
  next();
});

router.post('/auth/logout', member, wrap(async (req, res) => {
  await signOut(req.token);
  res.status(204).end();
}));

router.get('/auth/me', member, (req, res) => res.json({ user: req.member }));

router.get('/requests', member, wrap(async (req, res) => {
  const { requests, nextCursor } = await listRequests(req.member, req.query);
  if (nextCursor) res.set('X-Next-Cursor', nextCursor);
  res.json(requests);
}));

router.post('/requests', member, wrap(async (req, res) => {
  const { request, replayed } = await createRequest(req.member, req.payload);
  res.status(replayed ? 200 : 201).json(request);
}));

router.get('/requests/:id', member, wrap(async (req, res) => {
  res.json(await getRequest(req.member, req.params.id));
}));

router.get('/requests/:id/activity', member, wrap(async (req, res) => {
  res.json(await listActivity(req.member, req.params.id));
}));

router.post('/requests/:id/assignments', member, wrap(async (req, res) => {
  res.status(201).json(await assignTruck(req.member, req.params.id, req.payload));
}));

router.delete('/requests/:id/assignments/:truckId', member, wrap(async (req, res) => {
  await releaseTruck(req.member, req.params.id, req.params.truckId);
  res.status(204).end();
}));

router.post('/requests/:id/decision', member, wrap(async (req, res) => {
  res.json(await decide(req.member, req.params.id, req.payload));
}));

router.get('/dispatch', member, wrap(async (req, res) => {
  res.json(await dispatchBoard(req.member));
}));

router.get('/trucks', member, wrap(async (req, res) => {
  res.json(await listTrucks(req.member, req.query));
}));

router.patch('/trucks/:id', member, wrap(async (req, res) => {
  res.json(await setTruckStatus(req.member, req.params.id, req.payload));
}));

router.get('/users', member, wrap(async (req, res) => {
  res.json(await listMembers(req.member));
}));

router.patch('/users/:id', member, wrap(async (req, res) => {
  res.json(await setRole(req.member, req.params.id, req.payload));
}));

router.use((req, res, next) => next(refuse.notFound()));

const PARSER_ERRORS = {
  'entity.too.large': refuse.tooLarge,
  'entity.parse.failed': () => refuse.badRequest(COPY.badJson),
  'charset.unsupported': refuse.unsupportedMedia,
  'encoding.unsupported': refuse.unsupportedMedia,
};

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  let failure = err;
  if (!(failure instanceof AppError)) {
    const fromParser = PARSER_ERRORS[err && err.type];
    if (!fromParser) console.log(`api ${req.method} ${req.path}: ${err && err.message}`);
    failure = fromParser ? fromParser() : refuse.unavailable();
  }
  res.status(failure.status).set(failure.headers).json(failure.body);
});

module.exports = router;
