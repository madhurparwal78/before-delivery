'use strict';

const express = require('express');
const { render, baseContext } = require('./template');
const { REQUEST_STATUSES } = require('../lib/domain');
const validation = require('../lib/validation');
const operations = require('../lib/operations');

const PAGE_LIMIT = 50;

function safeNext(value) {
  if (typeof value === 'string' && /^\/[^/]/.test(value)) return value;
  if (value === '/') return '/';
  return '/requests';
}

function cursorEncode(createdAt, id) {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64');
}

function mount(app, { pool, store, auth, cookieName, fragments }) {
  app.locals.publicUrl = process.env.APP_PUBLIC_URL || `http://127.0.0.1:${process.env.APP_PUBLIC_PORT || 4173}`;

  const router = express.Router();
  app.use(router);

  // Every page and fragment authenticates by the session cookie.
  router.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/api/health' || req.path === '/health') return next();
    const token = req.cookies ? req.cookies[cookieName] : null;
    if (!token) {
      if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      return res.redirect('/login');
    }
    pool.connect().then(async (client) => {
      try {
        const member = await auth.memberForToken(client, token);
        if (!member) {
          if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
          return res.redirect('/login');
        }
        req.member = member;
        return next();
      } finally {
        client.release();
      }
    }).catch(() => renderUnavailable(req, res));
  });

  router.get('/', (req, res) => res.redirect('/requests'));

  router.get('/login', (req, res) => {
    if (req.member) return res.redirect('/requests');
    render(res, 'login.njk', 200, {
      member: null, nav: [], active: null, notices: [],
      publicUrl: app.locals.publicUrl, next: safeNext(req.query.next),
      error: null, email: '',
    });
  });

  router.post('/login', (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const nextPath = safeNext(req.body.next);
    auth.login(pool, email, password).then((result) => {
      if (result.status === 200) {
        res.cookie(cookieName, result.token, {
          httpOnly: true, sameSite: 'strict', path: '/',
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });
        return res.redirect(nextPath);
      }
      return render(res, 'login.njk', result.status, {
        member: null, nav: [], active: null, notices: [],
        publicUrl: app.locals.publicUrl, next: nextPath,
        error: result.body.message, email,
      });
    }).catch(() => renderUnavailable(req, res));
  });

  router.post('/logout', (req, res) => {
    const token = req.cookies[cookieName];
    auth.logout(pool, token)
      .then(() => {
        res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', path: '/' });
        res.redirect('/login');
      })
      .catch(() => renderUnavailable(req, res));
  });

  router.get('/requests', (req, res) => {
    const status = REQUEST_STATUSES.includes(req.query.status) ? req.query.status : '';
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    store.listRequests(req.member, { status: status || null, q, limit: PAGE_LIMIT + 1, cursor: null }).then((rows) => {
      const hasMore = rows.length > PAGE_LIMIT;
      const page = rows.slice(0, PAGE_LIMIT);
      const nextCursor = hasMore && page.length ? cursorEncode(page[page.length - 1].created_at, page[page.length - 1].id) : '';
      render(res, 'requests.njk', 200, {
        ...baseContext(req, req.member, { title: 'Requests', active: 'requests' }),
        requests: page, q, status, nextCursor, hasMore,
        isDispatcher: req.member.role !== 'tour_manager',
      });
    }).catch(() => renderUnavailable(req, res));
  });

  // New request: the three steps. The draft lives in the browser; the server
  // checks each step through one validator.
  router.get('/requests/new', (req, res) => {
    render(res, 'step1.njk', 200, {
      ...baseContext(req, req.member, { title: 'New request', active: 'requests' }),
      values: {}, errors: {},
    });
  });

  router.get('/requests/new/stops', (req, res) => {
    render(res, 'step2.njk', 200, {
      ...baseContext(req, req.member, { title: 'Stops', active: 'requests' }),
      errors: {},
    });
  });

  router.get('/requests/new/review', (req, res) => {
    render(res, 'step3.njk', 200, {
      ...baseContext(req, req.member, { title: 'Review', active: 'requests' }),
      errors: {},
    });
  });

  router.post('/requests/new/validate', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const draft = validation.validateRequestDraft(body);
    if (draft[validation.REJECTED]) {
      return res.status(200).json({ ok: false, fields: draft.fields });
    }
    res.status(200).json({ ok: true, fields: {} });
  });

  router.post('/requests/new/submit', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const draft = validation.validateRequestDraft(body);
    if (draft[validation.REJECTED]) {
      return res.status(422).json({ ok: false, fields: draft.fields });
    }
    operations.submitRequest(store, req.member, draft).then((result) => {
      res.status(200).json({ ok: true, id: result.request.id, redirect_url: `/requests/${result.request.id}/submitted` });
    }).catch(() => render(res, 'unavailable.njk', 503, baseContext(req, req.member, { title: 'Desk unavailable' })));
  });

  router.get('/requests/:id/submitted', asyncRoute(store, renderRequestPage('submitted.njk', { title: 'Request submitted' })));

  router.get('/requests/:id', asyncRoute(store, renderRequestPage('request_page.njk', { title: 'Request' })));
  const requireDispatcherPage = (req, res, next) => {
    if (req.member.role !== 'dispatcher' && req.member.role !== 'admin') {
      return renderForbidden(req, res);
    }
    return next();
  };

  router.get('/requests/:id/decided', requireDispatcherPage, asyncRoute(store, async (req, res, storeInstance) => {
    const request = await store.getRequest(req.member, req.params.id);
    if (!request) return renderRequestNotFound(req, res);
    render(res, 'decided.njk', 200, {
      ...baseContext(req, req.member, { title: 'Decision recorded' }),
      request,
    });
  }));

  router.get('/dispatch', requireDispatcherPage, (req, res) => {
    Promise.all([store.dispatchBoard(), store.board()]).then(([requests, summary]) => {
      render(res, 'dispatch.njk', 200, {
        ...baseContext(req, req.member, { title: 'Dispatch', active: 'dispatch' }),
        requests, summary,
      });
    }).catch(() => renderUnavailable(req, res));
  });

  router.get('/fleet', requireDispatcherPage, (req, res) => {
    const status = ['available', 'assigned', 'maintenance'].includes(req.query.state) ? req.query.state : '';
    Promise.all([store.trucks(status || null), store.board()]).then(([trucks, summary]) => {
      render(res, 'fleet.njk', 200, {
        ...baseContext(req, req.member, { title: 'Fleet', active: 'fleet' }),
        trucks, summary, state: status,
      });
    }).catch(() => renderUnavailable(req, res));
  });

  router.get('/admin/users', requireAdminPage, (req, res) => {
    store.members().then((members) => {
      render(res, 'users.njk', 200, {
        ...baseContext(req, req.member, { title: 'Members', active: 'members' }),
        members,
      });
    }).catch(() => renderUnavailable(req, res));
  });

  fragments.mount(router, { store, render, baseContext });

  function requireAdminPage(req, res, next) {
    if (req.member.role !== 'admin') return renderForbidden(req, res);
    return next();
  }

  function renderRequestPage(template, { title }) {
    return async (req, res, storeInstance) => {
      const request = await store.getRequest(req.member, req.params.id);
      if (!request) return renderRequestNotFound(req, res);
      const [activity, availableTrucks] = await Promise.all([
        store.activity(req.member, req.params.id),
        store.availableTrucksForPanel(),
      ]);
      render(res, template, 200, {
        ...baseContext(req, req.member, { title }),
        request, activity,
        available_trucks: availableTrucks,
        isDispatcher: req.member.role === 'dispatcher' || req.member.role === 'admin',
      });
    };
  }

  function asyncRoute(storeInstance, handler) {
    return (req, res) => Promise.resolve(handler(req, res, storeInstance))
      .catch(() => renderUnavailable(req, res));
  }
}

function shellContext(req, res, extra) {
  const { navFor } = require('./template');
  return {
    member: req.member || null,
    nav: req.member ? navFor(req.member) : [],
    active: null,
    notices: [],
    publicUrl: res.app.locals.publicUrl,
    ...extra,
  };
}

function renderNotFound(req, res) {
  render(res, 'not_found.njk', 404, shellContext(req, res, {
    title: '404. Wrong venue.', requestNotFound: false,
  }));
}

function renderRequestNotFound(req, res) {
  render(res, 'not_found.njk', 404, shellContext(req, res, {
    title: '404', requestNotFound: true,
  }));
}

function renderForbidden(req, res) {
  render(res, 'forbidden.njk', 403, shellContext(req, res, { title: 'No access' }));
}

function renderUnavailable(req, res) {
  render(res, 'unavailable.njk', 503, shellContext(req, res, { title: 'Desk unavailable' }));
}

module.exports = { mount, renderNotFound, renderRequestNotFound, renderForbidden, renderUnavailable };
