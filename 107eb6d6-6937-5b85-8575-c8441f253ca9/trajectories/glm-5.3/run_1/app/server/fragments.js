'use strict';

const { REQUEST_STATUSES, ACCESS_REFUSED } = require('../lib/domain');
const validation = require('../lib/validation');
const operations = require('../lib/operations');
const { ConflictError } = operations;
const { render } = require('./template');

// Every fragment address is checked exactly as its page is: sign-in, role,
// then ownership. The routers below run inside the page router, so the session
// cookie middleware has already authenticated the member and re-read its
// stored role.

function mount(router, { store, baseContext }) {
  const isDispatcher = (member) => member.role === 'dispatcher' || member.role === 'admin';

  function panelContext(req, res, request, notices, fieldErrors) {
    return Promise.all([
      store.availableTrucksForPanel(),
      store.activity(req.member, req.params.id),
    ]).then(([availableTrucks, activity]) => ({
      ...baseContext(req, req.member, {}),
      request,
      activity,
      available_trucks: availableTrucks,
      notices,
      field_errors: fieldErrors || {},
      isDispatcher: isDispatcher(req.member),
    }));
  }

  function respondPanel(req, res, { request, notices, fieldErrors, status }) {
    if (!request) return requestNotFoundFragment(req, res);
    return panelContext(req, res, request, notices, fieldErrors)
      .then((context) => render(res, 'panel.njk', status || 200, context))
      .catch(() => unavailableFragment(req, res));
  }

  function requestForFragment(req, res) {
    return store.getRequest(req.member, req.params.id);
  }

  function requestNotFoundFragment(req, res) {
    render(res, 'not_found_fragment.njk', 404, { request_not_found: true });
  }

  function refusedFragment(req, res, message) {
    render(res, 'refusal.njk', 403, {
      ...baseContext(req, req.member, {}),
      notice: ACCESS_REFUSED, message,
    });
  }

  // An outage inside a fragment shows the same 503 copy as the page, sized for
  // the region it swaps into.
  function unavailableFragment(req, res) {
    render(res, 'unavailable_fragment.njk', 503, {
      ...baseContext(req, req.member, {}),
    });
  }

  // The dispatch panel and everything derived from stored rows, redrawn after
  // every in-place write, success or refusal.
  router.get('/requests/:id/panel', (req, res) => {
    requestForFragment(req, res)
      .then((request) => {
        if (!request) return requestNotFoundFragment(req, res);
        return respondPanel(req, res, { request, notices: [] });
      })
      .catch(() => unavailableFragment(req, res));
  });

  router.get('/requests/:id/activity', (req, res) => {
    store.activity(req.member, req.params.id).then((entries) => {
      if (!entries) return render(res, 'not_found_fragment.njk', 404, { request_not_found: true });
      render(res, 'timeline.njk', 200, { activity: entries, error: false, request_id: req.params.id });
    }).catch((err) => {
      console.error(err);
      render(res, 'timeline.njk', 503, { activity: [], error: true, request_id: req.params.id });
    });
  });

  // Rows fragment for the request list's search, filter and paging.
  router.get('/requests-rows', (req, res) => {
    const status = REQUEST_STATUSES.includes(req.query.status) ? req.query.status : '';
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    let cursor = null;
    if (req.query.cursor) {
      try {
        const raw = Buffer.from(String(req.query.cursor), 'base64').toString('utf8');
        const match = /^([^|]+)\|(.+)$/.exec(raw);
        if (match) cursor = { createdAt: new Date(match[1]).toISOString(), id: match[2] };
      } catch { cursor = null; }
    }
    store.listRequests(req.member, { status: status || null, q, limit: 51, cursor }).then((rows) => {
      const hasMore = rows.length > 50;
      const page = rows.slice(0, 50);
      const nextCursor = hasMore && page.length
        ? Buffer.from(`${page[page.length - 1].created_at}|${page[page.length - 1].id}`).toString('base64') : '';
      render(res, 'rows.njk', 200, {
        ...baseContext(req, req.member, {}),
        requests: page, q, status, nextCursor, hasMore,
        isDispatcher: isDispatcher(req.member),
        append: req.query.append === '1',
      });
    }).catch(() => unavailableFragment(req, res));
  });

  function dispatcherFragment(req, res, next) {
    if (!isDispatcher(req.member)) return refusedFragment(req, res);
    return next();
  }

  router.post('/requests/:id/assignments', dispatcherFragment, (req, res) => {
    const parsed = validation.validateTruckId(req.body);
    if (parsed[validation.REJECTED]) {
      return requestForFragment(req, res).then((request) => respondPanel(req, res, {
        request, status: 422, notices: [parsed.fields.truck_id], fieldErrors: parsed.fields,
      }));
    }
    operations.assignTruck(store, req.member, req.params.id, parsed.truck_id)
      .then((result) => {
        if (result.notFound) return requestNotFoundFragment(req, res);
        if (result.validation) {
          return respondPanel(req, res, {
            request: result.request, status: 422, notices: [result.validation.truck_id], fieldErrors: result.validation,
          });
        }
        return respondPanel(req, res, { request: result.request, notices: ['Truck assigned'] });
      })
      .catch((err) => {
        if (err instanceof ConflictError) {
          return requestForFragment(req, res).then((request) => respondPanel(req, res, {
            request, status: 409, notices: [err.message],
          }));
        }
        return unavailableFragment(req, res);
      });
  });

  router.post('/requests/:id/assignments/:truckId/release', dispatcherFragment, (req, res) => {
    operations.releaseTruck(store, req.member, req.params.id, req.params.truckId)
      .then((result) => {
        if (result.notFound) return requestNotFoundFragment(req, res);
        return requestForFragment(req, res).then((request) => respondPanel(req, res, {
          request, notices: ['Truck released'],
        }));
      })
      .catch((err) => {
        if (err instanceof ConflictError) {
          return requestForFragment(req, res).then((request) => respondPanel(req, res, {
            request, status: 409, notices: [err.message],
          }));
        }
        return unavailableFragment(req, res);
      });
  });

  router.post('/requests/:id/decision', dispatcherFragment, (req, res) => {
    const decision = validation.validateDecision(req.body);
    if (decision[validation.REJECTED]) {
      return requestForFragment(req, res).then((request) => respondPanel(req, res, {
        request, status: 422, notices: [decision.fields.note || decision.fields.decision], fieldErrors: decision.fields,
      }));
    }
    operations.decideRequest(store, req.member, req.params.id, decision)
      .then((result) => {
        res.set('HX-Redirect', `/requests/${req.params.id}/decided`);
        res.status(200).send('');
      })
      .catch((err) => {
        if (err instanceof ConflictError) {
          return requestForFragment(req, res).then((request) => respondPanel(req, res, {
            request, status: 409, notices: [err.message],
          }));
        }
        return unavailableFragment(req, res);
      });
  });

  // Fleet maintenance fragment: one row plus the fleet summary line, redrawn
  // from stored rows whether the write succeeded or was refused.
  router.post('/trucks/:id/status', (req, res) => {
    if (req.member.role !== 'admin') return refusedFragment(req, res);
    const status = req.body && (req.body.status === 'available' || req.body.status === 'maintenance')
      ? req.body.status : null;
    const respond = (truck, notice, statusCode) => {
      store.board().then((summary) => {
        render(res, 'fleet_row.njk', statusCode || 200, {
          ...baseContext(req, req.member, {}),
          truck, notice, summary, state: '',
        });
      }).catch(() => unavailableFragment(req, res));
    };
    if (!status) {
      return store.trucks(null).then((trucks) => {
        const truck = trucks.find((t) => t.id === req.params.id);
        return respond(truck || { id: req.params.id, depot: 'north', status: 'available', request_id: null }, 'status must be available, assigned or maintenance.', 400);
      });
    }
    operations.setTruckStatus(store, req.member, req.params.id, status)
      .then((result) => {
        if (result.notFound) return render(res, 'not_found_fragment.njk', 404, { request_not_found: false });
        return respond(result.truck, 'Truck updated');
      })
      .catch((err) => {
        if (err instanceof ConflictError) {
          return store.trucks(null).then((trucks) => {
            const truck = trucks.find((t) => t.id === req.params.id);
            return respond(truck, err.message, 409);
          });
        }
        return unavailableFragment(req, res);
      });
  });

  // Member role fragment.
  router.post('/members/:id/role', (req, res) => {
    if (req.member.role !== 'admin') return refusedFragment(req, res);
    const parsed = validation.validateRole(req.body);
    if (parsed[validation.REJECTED]) {
      return store.members().then((members) => {
        const member = members.find((m) => String(m.id) === String(req.params.id));
        render(res, 'member_row.njk', 422, {
          ...baseContext(req, req.member, {}),
          member_row: member, notice: parsed.fields.role, members,
        });
      }).catch(() => unavailableFragment(req, res));
    }
    operations.setMemberRole(store, req.member, req.params.id, parsed.role)
      .then((result) => {
        if (result.notFound) return render(res, 'not_found_fragment.njk', 404, { request_not_found: false });
        render(res, 'member_row.njk', 200, {
          ...baseContext(req, req.member, {}),
          member_row: result.member, notice: 'Role saved', members: [result.member],
        });
      })
      .catch((err) => {
        if (err instanceof ConflictError) {
          return store.members().then((members) => {
            const member = members.find((m) => String(m.id) === String(req.params.id));
            render(res, 'member_row.njk', 409, {
              ...baseContext(req, req.member, {}),
              member_row: member, notice: err.message, members,
            });
          });
        }
        return unavailableFragment(req, res);
      });
  });
}

module.exports = { mount };
