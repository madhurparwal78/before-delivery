import express from 'express';
import { config } from '../config.js';
import { memberForToken, signIn, signOut } from '../domain/auth.js';
import { AppError, COPY } from '../domain/errors.js';
import {
  assignTruck,
  decideRequest,
  dispatchBoard,
  fleetSummary,
  listTrucks,
  releaseTruck,
  setTruckStatus
} from '../domain/fleet.js';
import { listMembers, setMemberRole } from '../domain/members.js';
import { createRequest, listRequests, loadActivity, loadRequest } from '../domain/requests.js';
import { canDispatch, isAdmin, isTourManager, requireRole } from '../domain/roles.js';
import {
  collectStops,
  collectTourDetails,
  parseRequestListQuery,
  parseTruckStatusQuery
} from '../domain/validation.js';
import {
  asyncRoute,
  bodyErrors,
  formBody,
  jsonBody,
  pageSession,
  sameOrigin,
  sessionToken
} from './middleware.js';

const STEPS = [
  { key: 'details', number: '1', name: 'Tour details', href: '/requests/new', template: 'fragments/step_details.njk' },
  { key: 'stops', number: '2', name: 'Stops', href: '/requests/new/stops', template: 'fragments/step_stops.njk' },
  { key: 'review', number: '3', name: 'Review', href: '/requests/new/review', template: 'fragments/step_review.njk' }
];

const NOTICES = {
  truckAssigned: 'Truck assigned',
  truckReleased: 'Truck released',
  truckUpdated: 'Truck updated',
  roleSaved: 'Role saved'
};

const isHtmx = (req) => Boolean(req.get('hx-request'));
const shellFor = (req) => (isHtmx(req) ? 'bare.njk' : req.member ? 'layout.njk' : 'shell_public.njk');

const safeNext = (value) =>
  typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : '/requests';

const roleContext = (member) => ({
  member,
  canDispatch: Boolean(member) && canDispatch(member),
  isAdmin: Boolean(member) && isAdmin(member),
  isTourManager: Boolean(member) && isTourManager(member)
});

const stepRail = (currentKey) => {
  const currentIndex = STEPS.findIndex((step) => step.key === currentKey);
  return STEPS.map((step, index) => ({
    name: step.name,
    href: step.href,
    state: index === currentIndex ? 'current' : index < currentIndex ? 'done' : 'later'
  }));
};

const view = (req, extra) => ({
  ...roleContext(req.member),
  title: extra.title,
  page: extra.page ?? '',
  notice: null,
  fields: {},
  ...extra
});

function redirectTo(req, res, target) {
  if (isHtmx(req)) {
    res.set('HX-Redirect', target);
    return res.status(200).end();
  }
  return res.redirect(303, target);
}

function noticeOnly(req, res, { status, notice }) {
  res.status(status).set('HX-Reswap', 'none').render('fragments/notice.njk', { notice });
}

async function requestPanelView(req, { request, notice = null, fields = {}, noteValue = '' }) {
  const panel = canDispatch(req.member) && request.status === 'submitted';
  return view(req, {
    title: request.tour_name,
    page: 'requests',
    request,
    panel,
    availableTrucks: panel ? await listTrucks({ status: 'available' }) : [],
    notice,
    fields,
    noteValue
  });
}

export function createPageRouter() {
  const pages = express.Router();

  pages.use(formBody, jsonBody);
  pages.use(bodyErrors);

  pages.get(
    '/',
    asyncRoute(async (req, res) => {
      const member = await memberForToken(sessionToken(req));
      res.redirect(303, member ? '/requests' : '/login');
    })
  );

  pages.get('/login', (req, res) => {
    res.render(
      'login.njk',
      view(req, { title: 'Sign in', page: 'login', next: safeNext(req.query.next), email: '', error: null })
    );
  });

  pages.post(
    '/login',
    sameOrigin,
    asyncRoute(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email : '';
      const next = safeNext(req.body?.next);
      try {
        const { token } = await signIn({ email, password: req.body?.password });
        res.cookie(config.sessionCookie, token, {
          httpOnly: true,
          sameSite: 'strict',
          path: '/'
        });
        return redirectTo(req, res, next);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        const context = view(req, {
          title: 'Sign in',
          page: 'login',
          next,
          email,
          error: error.body.message ?? COPY.unavailable
        });
        return res
          .status(error.status)
          .set(error.headers)
          .render(isHtmx(req) ? 'fragments/signin_form.njk' : 'login.njk', context);
      }
    })
  );

  pages.post(
    '/logout',
    sameOrigin,
    asyncRoute(async (req, res) => {
      const token = sessionToken(req);
      if (token) await signOut(token);
      res.clearCookie(config.sessionCookie, { httpOnly: true, sameSite: 'strict', path: '/' });
      return redirectTo(req, res, '/login');
    })
  );

  pages.get(
    '/requests',
    pageSession,
    asyncRoute(async (req, res) => {
      let filters = { status: null, q: '' };
      let notice = null;
      try {
        const parsed = parseRequestListQuery(req.query);
        filters = { status: parsed.status, q: parsed.q };
      } catch (error) {
        notice = error.body.message;
      }
      const { items, nextCursor } = await listRequests({
        member: req.member,
        status: filters.status,
        q: filters.q,
        limit: config.pageSize,
        cursor: null
      });
      res.render(
        'requests_list.njk',
        view(req, { title: 'Requests', page: 'requests', items, nextCursor, filters, notice })
      );
    })
  );

  pages.get(
    '/requests/list',
    pageSession,
    asyncRoute(async (req, res) => {
      let parsed;
      try {
        parsed = parseRequestListQuery(req.query);
      } catch (error) {
        return noticeOnly(req, res, { status: error.status, notice: error.body.message });
      }
      let page;
      try {
        page = await listRequests({
          member: req.member,
          status: parsed.status,
          q: parsed.q,
          limit: config.pageSize,
          cursor: parsed.cursor
        });
      } catch (error) {
        if (error instanceof AppError && error.status === 400) {
          return noticeOnly(req, res, { status: 400, notice: error.body.message });
        }
        throw error;
      }
      const context = view(req, {
        title: 'Requests',
        page: 'requests',
        items: page.items,
        nextCursor: page.nextCursor,
        filters: { status: parsed.status, q: parsed.q },
        appended: Boolean(parsed.cursor)
      });
      res.render(
        parsed.cursor ? 'fragments/request_rows_response.njk' : 'fragments/request_list_response.njk',
        context
      );
    })
  );

  for (const step of STEPS) {
    pages.get(step.href, pageSession, (req, res) => {
      res.render(
        'request_new.njk',
        view(req, {
          title: `New request, step ${step.number}`,
          page: 'requests',
          step,
          steps: stepRail(step.key),
          draft: {},
          fields: {}
        })
      );
    });
  }

  const renderStep = (req, res, step, { draft, fields }) => {
    const context = view(req, {
      title: step.name,
      page: 'requests',
      step,
      steps: stepRail(step.key),
      draft,
      fields
    });
    return res.status(422).render(isHtmx(req) ? step.template : 'request_new.njk', context);
  };

  pages.post('/requests/new', pageSession, sameOrigin, (req, res) => {
    const { fields } = collectTourDetails(req.body);
    if (Object.keys(fields).length > 0) return renderStep(req, res, STEPS[0], { draft: req.body, fields });
    return redirectTo(req, res, STEPS[1].href);
  });

  pages.post('/requests/new/stops', pageSession, sameOrigin, (req, res) => {
    const { fields } = collectStops(req.body);
    if (Object.keys(fields).length > 0) return renderStep(req, res, STEPS[1], { draft: req.body, fields });
    return redirectTo(req, res, STEPS[2].href);
  });

  pages.post(
    '/requests/new/review',
    pageSession,
    sameOrigin,
    asyncRoute(async (req, res) => {
      try {
        const { request } = await createRequest({ member: req.member, body: req.body });
        return redirectTo(req, res, `/requests/${request.id}/submitted`);
      } catch (error) {
        if (error instanceof AppError && error.status === 422) {
          return renderStep(req, res, STEPS[2], { draft: req.body, fields: error.body.fields });
        }
        throw error;
      }
    })
  );

  pages.get(
    '/requests/:id',
    pageSession,
    asyncRoute(async (req, res) => {
      req.requestScope = true;
      const request = await loadRequest({ member: req.member, id: req.params.id });
      res.render('request_detail.njk', await requestPanelView(req, { request }));
    })
  );

  pages.get(
    '/requests/:id/activity',
    pageSession,
    asyncRoute(async (req, res) => {
      req.requestScope = true;
      const activity = await loadActivity({ member: req.member, id: req.params.id });
      res.render('fragments/activity.njk', view(req, { title: 'Activity', activity }));
    })
  );

  pages.get(
    '/requests/:id/submitted',
    pageSession,
    asyncRoute(async (req, res) => {
      req.requestScope = true;
      const request = await loadRequest({ member: req.member, id: req.params.id });
      res.render(
        'request_submitted.njk',
        view(req, { title: 'Request submitted', page: 'requests', request })
      );
    })
  );

  pages.get(
    '/requests/:id/decided',
    pageSession,
    asyncRoute(async (req, res) => {
      requireRole(req.member, canDispatch);
      req.requestScope = true;
      const request = await loadRequest({ member: req.member, id: req.params.id });
      res.render(
        'request_decided.njk',
        view(req, { title: 'Decision recorded', page: 'requests', request })
      );
    })
  );

  const panelWrite = (write, successNotice) =>
    asyncRoute(async (req, res) => {
      req.requestScope = true;
      const requestId = req.params.id;
      try {
        requireRole(req.member, canDispatch);
        const request = await write(req);
        if (successNotice === null) return redirectTo(req, res, `/requests/${requestId}/decided`);
        res.render(
          'fragments/request_panel_response.njk',
          await requestPanelView(req, { request, notice: successNotice })
        );
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        if (error.status === 409 || error.status === 422) {
          const request = await loadRequest({ member: req.member, id: requestId });
          return res.status(error.status).render(
            'fragments/request_panel_response.njk',
            await requestPanelView(req, {
              request,
              notice: error.body.message ?? Object.values(error.body.fields ?? {})[0],
              fields: error.body.fields ?? {},
              noteValue: typeof req.body?.note === 'string' ? req.body.note : ''
            })
          );
        }
        if (error.status === 503) {
          return noticeOnly(req, res, { status: 503, notice: COPY.unavailable });
        }
        throw error;
      }
    });

  pages.post(
    '/requests/:id/assign',
    pageSession,
    sameOrigin,
    panelWrite(
      (req) => assignTruck({ member: req.member, requestId: req.params.id, body: req.body }),
      NOTICES.truckAssigned
    )
  );

  pages.post(
    '/requests/:id/release',
    pageSession,
    sameOrigin,
    panelWrite(
      (req) =>
        releaseTruck({
          member: req.member,
          requestId: req.params.id,
          truckId: typeof req.body?.truck_id === 'string' ? req.body.truck_id : ''
        }),
      NOTICES.truckReleased
    )
  );

  pages.post(
    '/requests/:id/decision',
    pageSession,
    sameOrigin,
    panelWrite((req) => decideRequest({ member: req.member, requestId: req.params.id, body: req.body }), null)
  );

  pages.get(
    '/dispatch',
    pageSession,
    asyncRoute(async (req, res) => {
      requireRole(req.member, canDispatch);
      const board = await dispatchBoard();
      res.render('dispatch.njk', view(req, { title: 'Dispatch', page: 'dispatch', board }));
    })
  );

  pages.get(
    '/fleet',
    pageSession,
    asyncRoute(async (req, res) => {
      requireRole(req.member, canDispatch);
      let status = null;
      let notice = null;
      try {
        status = parseTruckStatusQuery(req.query);
      } catch (error) {
        notice = error.body.message;
      }
      const [trucks, summary] = await Promise.all([listTrucks({ status }), fleetSummary()]);
      res.render(
        'fleet.njk',
        view(req, { title: 'Fleet', page: 'fleet', trucks, summary, filters: { status }, notice })
      );
    })
  );

  pages.post(
    '/fleet/:truckId',
    pageSession,
    sameOrigin,
    asyncRoute(async (req, res) => {
      try {
        requireRole(req.member, isAdmin);
        const truck = await setTruckStatus({ truckId: req.params.truckId, body: req.body });
        const summary = await fleetSummary();
        return res.render(
          'fragments/fleet_row_response.njk',
          view(req, { title: 'Fleet', page: 'fleet', truck, summary, notice: NOTICES.truckUpdated })
        );
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        if (error.status === 409 || error.status === 422) {
          const [trucks, summary] = await Promise.all([listTrucks(), fleetSummary()]);
          const truck = trucks.find((row) => row.id === req.params.truckId);
          return res.status(error.status).render(
            'fragments/fleet_row_response.njk',
            view(req, {
              title: 'Fleet',
              page: 'fleet',
              truck,
              summary,
              notice: error.body.message ?? Object.values(error.body.fields ?? {})[0]
            })
          );
        }
        if (error.status === 503) return noticeOnly(req, res, { status: 503, notice: COPY.unavailable });
        throw error;
      }
    })
  );

  pages.get(
    '/admin/users',
    pageSession,
    asyncRoute(async (req, res) => {
      requireRole(req.member, isAdmin);
      res.render(
        'admin_users.njk',
        view(req, { title: 'Members', page: 'members', members: await listMembers() })
      );
    })
  );

  pages.post(
    '/admin/users/:memberId',
    pageSession,
    sameOrigin,
    asyncRoute(async (req, res) => {
      const memberId = Number.parseInt(req.params.memberId, 10);
      try {
        requireRole(req.member, isAdmin);
        const row = await setMemberRole({ memberId, body: req.body });
        return res.render(
          'fragments/member_row_response.njk',
          view(req, { title: 'Members', page: 'members', row, notice: NOTICES.roleSaved })
        );
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        if (error.status === 409 || error.status === 422) {
          const row = (await listMembers()).find((member) => member.id === memberId);
          return res.status(error.status).render(
            'fragments/member_row_response.njk',
            view(req, {
              title: 'Members',
              page: 'members',
              row,
              notice: error.body.message ?? Object.values(error.body.fields ?? {})[0]
            })
          );
        }
        if (error.status === 503) return noticeOnly(req, res, { status: 503, notice: COPY.unavailable });
        throw error;
      }
    })
  );

  return pages;
}

export function pageErrors(error, req, res, next) {
  const context = {
    ...roleContext(req.member),
    title: 'Gigfreight',
    page: req.member ? 'requests' : 'login',
    shellTemplate: shellFor(req)
  };
  if (error instanceof AppError) {
    if (error.status === 403) return res.status(403).render('errors/forbidden.njk', context);
    if (error.status === 404) {
      const template = req.requestScope ? 'errors/request_not_found.njk' : 'errors/not_found.njk';
      return res.status(404).render(template, context);
    }
    if (error.status === 503) return res.status(503).render('errors/unavailable.njk', context);
    if (error.status < 500) {
      return res.status(error.status).type('text/plain').send(error.body.message ?? error.body.error);
    }
  }
  console.error('unhandled page error', error);
  return res.status(500).type('text/plain').send('The desk hit an unexpected error.');
}
