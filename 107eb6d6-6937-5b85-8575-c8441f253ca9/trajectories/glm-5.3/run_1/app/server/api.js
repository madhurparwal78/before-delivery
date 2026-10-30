'use strict';

const express = require('express');
const {
  REQUEST_STATUSES, TRUCK_STATUS, LIMIT_BAD_REQUEST, CURSOR_BAD_REQUEST,
  STATUS_BAD_REQUEST, UNAVAILABLE_MESSAGE,
} = require('../lib/domain');
const validation = require('../lib/validation');
const operations = require('../lib/operations');
const { ConflictError } = operations;

const ACCESS_REFUSED = 'You do not have access to this page.';

function unavailable(res) {
  return res.status(503).json({ error: 'unavailable', message: UNAVAILABLE_MESSAGE });
}

function cursorEncode(createdAt, id) {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64');
}

function cursorDecode(value) {
  try {
    const raw = Buffer.from(String(value), 'base64').toString('utf8');
    const match = /^([^|]+)\|(.+)$/.exec(raw);
    if (!match) return null;
    const date = new Date(match[1]);
    if (Number.isNaN(date.getTime())) return null;
    return { createdAt: date.toISOString(), id: match[2] };
  } catch {
    return null;
  }
}

function mount(app, { pool, store, auth }) {
  const router = express.Router();
  app.use('/api', router);

  // Schema and seed must be applied before anything but health reports "ok".
  const schemaState = { applied: false };
  const markApplied = () => { schemaState.applied = true; };

  // Body readers first, so 413 and 415 precede every other rule.
  router.use((req, res, next) => {
    if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) return next();
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const length = Number(req.headers['content-length'] || 0);
    if (length > 0 && type !== 'application/json') {
      return res.status(415).json({ error: 'unsupported_media_type', message: 'Send the body as application/json.' });
    }
    if (length === 0) { req.body = undefined; }
    return next();
  });

  // Bearer authentication for every /api route but health and login.
  router.use((req, res, next) => {
    if (req.path === '/health' || (req.path === '/auth/login' && req.method === 'POST')) {
      return next();
    }
    const header = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return res.status(401).json({ error: 'unauthenticated' });
    pool.connect().then(async (client) => {
      try {
        const member = await auth.memberForToken(client, match[1].trim());
        if (!member) return res.status(401).json({ error: 'unauthenticated' });
        req.member = member;
        return next();
      } finally {
        client.release();
      }
    }).catch(() => unavailable(res));
  });

  const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.member.role)) {
      return res.status(403).json({ error: 'forbidden', message: ACCESS_REFUSED });
    }
    return next();
  };

  router.get('/health', (req, res) => {
    if (!schemaState.applied) return res.status(503).json({ status: 'unavailable' });
    return pool.query('SELECT 1').then(() => res.status(200).json({ status: 'ok' }))
      .catch(() => res.status(503).json({ status: 'unavailable' }));
  });

  router.post('/auth/login', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    auth.login(pool, body.email, body.password).then((result) => {
      if (result.status === 200) return res.status(200).json({ token: result.token, user: result.user });
      if (result.status === 429) {
        res.set('Retry-After', String(result.retryAfter));
        return res.status(429).json(result.body);
      }
      return res.status(401).json(result.body);
    }).catch(() => unavailable(res));
  });

  router.post('/auth/logout', (req, res) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')[1];
    auth.logout(pool, token.trim()).then(() => res.status(204).end())
      .catch(() => unavailable(res));
  });

  router.get('/auth/me', (req, res) => {
    const { id, name, email, role } = req.member;
    res.status(200).json({ user: { id, name, email, role } });
  });

  router.get('/requests', (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !REQUEST_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'bad_request', message: STATUS_BAD_REQUEST.request });
    }
    let limit = 50;
    if (req.query.limit !== undefined) {
      const parsed = Number(req.query.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100 || String(parsed) !== String(req.query.limit).trim()) {
        return res.status(400).json({ error: 'bad_request', message: LIMIT_BAD_REQUEST });
      }
      limit = parsed;
    }
    let cursor = null;
    if (req.query.cursor !== undefined && req.query.cursor !== '') {
      cursor = cursorDecode(req.query.cursor);
      if (!cursor) return res.status(400).json({ error: 'bad_request', message: CURSOR_BAD_REQUEST });
    }
    const q = req.query.q !== undefined ? String(req.query.q) : '';
    store.listRequests(req.member, { status: status || null, q, limit, cursor }).then((rows) => {
      const page = rows.slice(0, limit);
      if (rows.length > limit) {
        const last = page[page.length - 1];
        res.set('X-Next-Cursor', cursorEncode(last.created_at, last.id));
      }
      res.status(200).json(page);
    }).catch(() => unavailable(res));
  });

  router.post('/requests', (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const run = async () => {
      const draftIdReason = validation.validateDraftId(body.draft_id);
      if (draftIdReason) {
        return res.status(422).json({ error: 'validation', fields: { draft_id: draftIdReason } });
      }
      if (body.draft_id != null) {
        const replay = await store.pool.query(
          'SELECT id FROM logistics_requests WHERE requester_id = $1 AND draft_id = $2',
          [req.member.id, String(body.draft_id).trim().toLowerCase()],
        );
        if (replay.rows[0]) {
          const request = await store.getRequest(req.member, replay.rows[0].id);
          return res.status(200).json(request);
        }
      }
      const draft = validation.validateRequestDraft(body);
      if (draft[validation.REJECTED]) {
        return res.status(422).json({ error: 'validation', fields: draft.fields });
      }
      const result = await operations.submitRequest(store, req.member, draft);
      return res.status(result.status).json(result.request);
    };
    run().catch((err) => respondToWrite(err, res));
  });

  router.get('/requests/:id', (req, res) => {
    store.getRequest(req.member, req.params.id).then((request) => {
      if (!request) return res.status(404).json({ error: 'not_found' });
      res.status(200).json(request);
    }).catch(() => unavailable(res));
  });

  router.get('/requests/:id/activity', (req, res) => {
    store.activity(req.member, req.params.id).then((entries) => {
      if (!entries) return res.status(404).json({ error: 'not_found' });
      res.status(200).json(entries);
    }).catch(() => unavailable(res));
  });

  // Error precedence: the path record comes before body validation, so the
  // existence read runs first and the operation re-checks inside its lock.
  router.post('/requests/:id/assignments', requireRole('dispatcher', 'admin'), (req, res) => {
    store.getRequest(req.member, req.params.id).then((request) => {
      if (!request) return res.status(404).json({ error: 'not_found' });
      const parsed = validation.validateTruckId(req.body);
      if (parsed[validation.REJECTED]) {
        return res.status(422).json({ error: 'validation', fields: parsed.fields });
      }
      return operations.assignTruck(store, req.member, req.params.id, parsed.truck_id)
        .then((result) => respondResult(result, res, req.member))
        .catch((err) => respondToWrite(err, res));
    }).catch(() => unavailable(res));
  });

  router.delete('/requests/:id/assignments/:truckId', requireRole('dispatcher', 'admin'), (req, res) => {
    operations.releaseTruck(store, req.member, req.params.id, req.params.truckId)
      .then((result) => respondResult(result, res, req.member))
      .catch((err) => respondToWrite(err, res));
  });

  router.post('/requests/:id/decision', requireRole('dispatcher', 'admin'), (req, res) => {
    store.getRequest(req.member, req.params.id).then((request) => {
      if (!request) return res.status(404).json({ error: 'not_found' });
      const decision = validation.validateDecision(req.body);
      if (decision[validation.REJECTED]) {
        return res.status(422).json({ error: 'validation', fields: decision.fields });
      }
      return operations.decideRequest(store, req.member, req.params.id, decision)
        .then((result) => respondResult(result, res, req.member))
        .catch((err) => respondToWrite(err, res));
    }).catch(() => unavailable(res));
  });

  router.get('/dispatch', requireRole('dispatcher', 'admin'), (req, res) => {
    Promise.all([store.dispatchBoard(), store.board()]).then(([requests, summary]) => {
      res.status(200).json({ requests, summary });
    }).catch(() => unavailable(res));
  });

  router.get('/trucks', requireRole('dispatcher', 'admin'), (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !TRUCK_STATUS.includes(status)) {
      return res.status(400).json({ error: 'bad_request', message: STATUS_BAD_REQUEST.truck });
    }
    store.trucks(status || null).then((trucks) => res.status(200).json(trucks))
      .catch(() => unavailable(res));
  });

  router.patch('/trucks/:id', requireRole('admin'), (req, res) => {
    pool.query('SELECT 1 FROM trucks WHERE id = $1', [req.params.id]).then((found) => {
      if (found.rowCount === 0) return res.status(404).json({ error: 'not_found' });
      const status = validation.validateTruckStatus(req.body);
      if (!status) {
        return res.status(400).json({ error: 'bad_request', message: STATUS_BAD_REQUEST.truck });
      }
      return operations.setTruckStatus(store, req.member, req.params.id, status)
        .then((result) => {
          if (result.notFound) return res.status(404).json({ error: 'not_found' });
          return res.status(200).json(result.truck);
        })
        .catch((err) => respondToWrite(err, res));
    }).catch(() => unavailable(res));
  });

  router.get('/users', requireRole('admin'), (req, res) => {
    store.members().then((members) => res.status(200).json(members))
      .catch(() => unavailable(res));
  });

  router.patch('/users/:id', requireRole('admin'), (req, res) => {
    pool.query('SELECT 1 FROM members WHERE id = $1', [req.params.id]).then((found) => {
      if (found.rowCount === 0) return res.status(404).json({ error: 'not_found' });
      const parsed = validation.validateRole(req.body);
      if (parsed[validation.REJECTED]) {
        return res.status(422).json({ error: 'validation', fields: parsed.fields });
      }
      return operations.setMemberRole(store, req.member, req.params.id, parsed.role)
        .then((result) => {
          if (result.notFound) return res.status(404).json({ error: 'not_found' });
          return res.status(200).json(result.member);
        })
        .catch((err) => respondToWrite(err, res));
    }).catch(() => unavailable(res));
  });

  function respondResult(result, res, member) {
    if (result.notFound) return res.status(404).json({ error: 'not_found' });
    if (result.validation) return res.status(422).json({ error: 'validation', fields: result.validation });
    if (result.status === 204) return res.status(204).end();
    return res.status(result.status).json(result.request);
  }

  function respondToWrite(err, res) {
    if (err instanceof ConflictError) {
      return res.status(409).json({ error: 'conflict', message: err.message });
    }
    console.error(err);
    return unavailable(res);
  }

  router.use((req, res) => res.status(404).json({ error: 'not_found' }));
  return markApplied;
}

module.exports = { mount };
