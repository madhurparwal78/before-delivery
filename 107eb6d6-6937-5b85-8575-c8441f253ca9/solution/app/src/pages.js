'use strict';
// Server-rendered pages and the htmx fragments they swap. The browser authenticates
// by the session cookie (HTTP-only, same-site strict); every fragment is checked as
// its page is: sign-in, role, then ownership.
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { memberForToken, signIn, signOut } = require('./auth');
const {
  STOP_KINDS, STOP_FIELDS, mayDispatch, isAdmin, checkTour, checkStops, listRequests, getRequest, requestPage,
  decidedRequest, listActivity, dispatchBoard, fleet, listMembers, findMember, createRequest, assignTruck,
  releaseTruck, decide, setTruckStatus, setRole,
} = require('./desk');
const { AppError, COPY } = require('./messages');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const SESSION = 'gf_session';
const DRAFT = 'gf_draft';
const MOTION = 'gf_motion';
const DRAFT_CHUNK = 3500;
const DRAFT_CHUNKS = 4;

// ---------------------------------------------------------------- cookies
function readCookies(req) {
  const jar = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) jar[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return jar;
}

const secure = config.publicUrl.startsWith('https:') ? '; Secure' : '';

function setCookie(res, name, value, { path = '/', maxAge }) {
  res.append('Set-Cookie', `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`);
}

// ---------------------------------------------------------------- the draft
// The New request draft lives in the browser as cookies scoped to the steps,
// split into chunks so a long draft still fits. The server re-checks it on every step.
const DRAFT_PATH = '/requests/new';

function emptyDraft() {
  const stops = {};
  for (const kind of STOP_KINDS) {
    stops[kind] = { date: '', address: '', city: '', region: '', postal_code: '', country: '' };
  }
  return { draft_id: '', tour_name: '', transport_type: '', trucks_requested: '', notes: '', stops };
}

function readDraft(req) {
  const jar = readCookies(req);
  let encoded = '';
  for (let i = 0; i < DRAFT_CHUNKS && jar[`${DRAFT}${i}`]; i += 1) encoded += jar[`${DRAFT}${i}`];
  try {
    return mergeDraft(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')), {});
  } catch {
    return emptyDraft();
  }
}

function writeDraft(res, draft) {
  const encoded = Buffer.from(JSON.stringify(draft)).toString('base64url');
  for (let i = 0; i < DRAFT_CHUNKS; i += 1) {
    const chunk = encoded.slice(i * DRAFT_CHUNK, (i + 1) * DRAFT_CHUNK);
    setCookie(res, `${DRAFT}${i}`, chunk, { path: DRAFT_PATH, maxAge: chunk ? 7 * 24 * 3600 : 0 });
  }
}

function clearDraft(res) {
  for (let i = 0; i < DRAFT_CHUNKS; i += 1) setCookie(res, `${DRAFT}${i}`, '', { path: DRAFT_PATH, maxAge: 0 });
}

const field = (value) => (typeof value === 'string' ? value.slice(0, 1000) : '');

// Lay typed form fields (flat names such as `pickup.city`) over a stored draft.
function mergeDraft(base, patch) {
  const draft = emptyDraft();
  for (const key of ['draft_id', 'tour_name', 'transport_type', 'trucks_requested', 'notes']) {
    draft[key] = field(patch[key] !== undefined ? patch[key] : base[key]);
  }
  for (const kind of STOP_KINDS) {
    const stored = (base.stops && base.stops[kind]) || {};
    for (const name of ['date', ...STOP_FIELDS]) {
      const typed = patch[`${kind}.${name}`];
      draft.stops[kind][name] = field(typed !== undefined ? typed : stored[name]);
    }
  }
  return draft;
}

const tourReady = (draft) => !Object.keys(checkTour(draft).fields).length;
const stopsReady = (draft) => !Object.keys(checkStops(draft.stops).fields).length;

// ---------------------------------------------------------------- rendering
const isFragment = (req) => req.get('HX-Request') === 'true';

function hxRedirect(res, to) {
  res.set('HX-Redirect', to).status(200).end();
}

const REFUSALS = {
  forbidden: { status: 403, title: 'No access', headline: 'Not your desk.', line: COPY.forbidden },
  missing: { status: 404, title: 'Request not found', headline: 'No such request.', line: COPY.missingRequest },
  wrongVenue: { status: 404, title: 'Wrong venue', headline: COPY.wrongVenue, line: COPY.wrongVenueLine },
  tooLarge: { status: 413, title: 'Too large', headline: 'Too much freight.', line: COPY.tooLarge },
  unavailable: { status: 503, title: 'Records unreachable', headline: 'Lights out.', line: COPY.unavailable },
};

// Every page refusal renders through message.njk; inside a page the same refusal is
// a notice in Desk notices, and nothing else on the page changes.
function refusal(req, res, kind) {
  const r = REFUSALS[kind];
  if (isFragment(req)) {
    if (r.status >= 500) return res.status(r.status).type('text/plain').send(r.line);
    return res.status(r.status).set('HX-Reswap', 'none').render('partials/notice.njk', { notice: r.line, problem: true });
  }
  return res.status(r.status).render('message.njk', r);
}

// ---------------------------------------------------------------- session
router.use(express.urlencoded({ extended: false, limit: 100000 }));

router.use(wrap(async (req, res, next) => {
  const jar = readCookies(req);
  req.sessionToken = jar[SESSION] || null;
  req.member = await memberForToken(req.sessionToken);
  res.locals.member = req.member;
  // What the stored role lets this member reach, for drawing the navigation and
  // controls; every write is still decided in desk.js.
  res.locals.can = req.member ? { dispatch: mayDispatch(req.member), admin: isAdmin(req.member) } : {};
  res.locals.path = req.path;
  res.locals.reduceMotion = jar[MOTION] === 'reduce';
  res.set('Cache-Control', 'no-store').set('Vary', 'HX-Request');
  next();
}));

// A page or fragment write from another origin is refused.
router.use((req, res, next) => {
  const origin = req.get('origin');
  const own = [`${req.protocol}://${req.get('host')}`, config.publicUrl && new URL(config.publicUrl).origin];
  if (req.method === 'GET' || !origin || own.includes(origin)) return next();
  return refusal(req, res, 'forbidden');
});

function signedIn(req, res, next) {
  if (req.member) return next();
  const back = isFragment(req) ? new URL(req.get('HX-Current-URL') || '/', 'http://desk').pathname : req.originalUrl;
  const to = `/login?next=${encodeURIComponent(back)}`;
  if (isFragment(req)) return res.set('HX-Redirect', to).status(401).end();
  return res.redirect(302, to);
}

// ---------------------------------------------------------------- sign in
function nextPath(value) {
  const target = typeof value === 'string' ? value : '';
  return /^\/(?![/\\])/.test(target) ? target : '/requests';
}

router.get('/', (req, res) => res.redirect(302, req.member ? '/requests' : '/login'));

router.get('/login', (req, res) => {
  if (req.member) return res.redirect(302, nextPath(req.query.next));
  return res.render('login.njk', { title: 'Sign in', next: nextPath(req.query.next), email: '' });
});

router.post('/login', wrap(async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email : '';
  const next = nextPath(req.body.next);
  try {
    const session = await signIn(email, req.body.password);
    setCookie(res, SESSION, session.token, { maxAge: 30 * 24 * 3600 });
    return res.redirect(303, next);
  } catch (err) {
    const known = err instanceof AppError;
    if (!known) console.log(`sign-in failure: ${err.message}`);
    if (known && err.headers['Retry-After']) res.set('Retry-After', err.headers['Retry-After']);
    return res.status(known ? err.status : 503).render('login.njk',
      { title: 'Sign in', next, email, failure: known ? err.body.message : COPY.unavailable });
  }
}));

router.post('/logout', wrap(async (req, res) => {
  if (req.sessionToken) await signOut(req.sessionToken);
  setCookie(res, SESSION, '', { maxAge: 0 });
  res.redirect(303, '/login');
}));

// ---------------------------------------------------------------- requests list
router.get('/requests', signedIn, wrap(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const ctx = { q, status };
  let page;
  try {
    page = await listRequests(req.member, req.query);
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 400) throw err;
    if (isFragment(req)) return res.status(400).set('HX-Reswap', 'none').render('partials/notice.njk', { notice: err.body.message, problem: true });
    page = await listRequests(req.member, {});
    Object.assign(ctx, { status: '', notice: err.body.message, problem: true });
    res.status(400);
  }
  Object.assign(ctx, { rows: page.requests, nextCursor: page.nextCursor });
  if (isFragment(req) && req.query.cursor) return res.render('partials/request_more.njk', ctx);
  if (isFragment(req)) return res.render('partials/request_results.njk', ctx);
  return res.render('requests.njk', { ...ctx, title: 'Requests' });
}));

// ---------------------------------------------------------------- new request
const stepContext = (draft, step, errors = {}) => ({ title: 'New request', draft, step, errors });

router.get('/requests/new', signedIn, (req, res) => {
  res.render('new_request.njk', stepContext(readDraft(req), 1));
});

router.get('/requests/new/stops', signedIn, (req, res) => {
  const draft = readDraft(req);
  if (!tourReady(draft)) return res.redirect(302, '/requests/new');
  return res.render('new_request.njk', stepContext(draft, 2));
});

router.get('/requests/new/review', signedIn, (req, res) => {
  const draft = readDraft(req);
  if (!tourReady(draft)) return res.redirect(302, '/requests/new');
  if (!stopsReady(draft)) return res.redirect(302, '/requests/new/stops');
  return res.render('new_request.njk', stepContext(draft, 3));
});

router.post('/requests/new', signedIn, (req, res) => {
  const draft = mergeDraft(readDraft(req), req.body);
  const { fields } = checkTour(draft);
  if (Object.keys(fields).length) {
    writeDraft(res, draft);
    return res.status(422).render('partials/step_form.njk', stepContext(draft, 1, fields));
  }
  draft.draft_id = draft.draft_id || crypto.randomUUID();
  writeDraft(res, draft);
  return hxRedirect(res, '/requests/new/stops');
});

router.post('/requests/new/stops', signedIn, (req, res) => {
  const draft = mergeDraft(readDraft(req), req.body);
  writeDraft(res, draft);
  if (req.body.action === 'back' || !tourReady(draft)) return hxRedirect(res, '/requests/new');
  const { fields } = checkStops(draft.stops);
  if (Object.keys(fields).length) return res.status(422).render('partials/step_form.njk', stepContext(draft, 2, fields));
  return hxRedirect(res, '/requests/new/review');
});

router.post('/requests/new/review', signedIn, wrap(async (req, res) => {
  const draft = mergeDraft(readDraft(req), req.body);
  if (req.body.action === 'back') {
    writeDraft(res, draft);
    return hxRedirect(res, '/requests/new/stops');
  }
  try {
    const { request } = await createRequest(req.member, { ...draft, draft_id: draft.draft_id || null });
    clearDraft(res);
    return hxRedirect(res, `/requests/${request.id}/submitted`);
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 422) throw err;
    writeDraft(res, draft);
    if (!tourReady(draft)) return hxRedirect(res, '/requests/new');
    if (!stopsReady(draft)) return hxRedirect(res, '/requests/new/stops');
    return res.status(422).render('partials/step_form.njk', stepContext(draft, 3, err.body.fields));
  }
}));

router.delete('/requests/new', signedIn, (req, res) => {
  clearDraft(res);
  hxRedirect(res, '/requests');
});

// ---------------------------------------------------------------- one request
// A request the member may not see, or a page their role may not use, reaches the
// error handler below as a 404 or 403 and renders its refusal.
router.get('/requests/:id', signedIn, wrap(async (req, res) => {
  const ctx = await requestPage(req.member, req.params.id);
  res.render('request.njk', { title: ctx.request.tour_name, errors: {}, note: '', ...ctx });
}));

router.get('/requests/:id/submitted', signedIn, wrap(async (req, res) => {
  const request = await getRequest(req.member, req.params.id);
  res.render('confirmation.njk', { title: 'Request submitted', headline: 'Request submitted', request });
}));

router.get('/requests/:id/decided', signedIn, wrap(async (req, res) => {
  const request = await decidedRequest(req.member, req.params.id);
  res.render('confirmation.njk', { title: 'Decision recorded', headline: 'Decision recorded', request });
}));

router.get('/requests/:id/activity', signedIn, wrap(async (req, res) => {
  res.render('partials/activity.njk', { entries: await listActivity(req.member, req.params.id) });
}));

// After a panel write, success or refusal, the request is redrawn from storage with
// the outcome in Desk notices. A member who lost the role reads the refusal and
// loses the panel; a request they may not see answers as a missing one.
async function panelWrite(req, res, write, success) {
  const id = req.params.id;
  const note = typeof req.body.note === 'string' ? req.body.note : '';
  let outcome;
  try {
    await write();
    if (success.redirect) return hxRedirect(res, success.redirect);
    outcome = { status: 200, notice: success.notice, released: success.released };
  } catch (err) {
    if (!(err instanceof AppError) || err.status === 404) throw err;
    const fields = err.body.fields || {};
    outcome = { status: err.status, notice: err.body.message || Object.values(fields)[0], problem: true, errors: fields };
  }
  const page = await requestPage(req.member, id);
  const entries = await listActivity(req.member, id);
  return res.status(outcome.status).render('partials/request_body.njk',
    { errors: {}, note, redraw: true, entries, ...page, ...outcome });
}

router.post('/requests/:id/assignments', signedIn, wrap((req, res) => panelWrite(req, res,
  () => assignTruck(req.member, req.params.id, { truck_id: req.body.truck_id }), { notice: 'Truck assigned' })));

router.delete('/requests/:id/assignments/:truckId', signedIn, wrap((req, res) => panelWrite(req, res,
  () => releaseTruck(req.member, req.params.id, req.params.truckId),
  { notice: 'Truck released', released: req.params.truckId })));

router.post('/requests/:id/decision', signedIn, wrap((req, res) => panelWrite(req, res,
  () => decide(req.member, req.params.id, { decision: req.body.decision, note: req.body.note }),
  { redirect: `/requests/${req.params.id}/decided` })));

// ---------------------------------------------------------------- dispatch, fleet, members
router.get('/dispatch', signedIn, wrap(async (req, res) => {
  res.render('dispatch.njk', { title: 'Dispatch', board: await dispatchBoard(req.member) });
}));

router.get('/fleet', signedIn, wrap(async (req, res) => {
  res.render('fleet.njk', { title: 'Fleet', ...(await fleet(req.member)) });
}));

router.patch('/fleet/:truckId', signedIn, wrap(async (req, res) => {
  let outcome = { status: 200, notice: 'Truck updated' };
  try {
    await setTruckStatus(req.member, req.params.truckId, { status: req.body.status });
  } catch (err) {
    if (!(err instanceof AppError) || err.status === 403) throw err;
    if (err.status === 404) return refusal(req, res, 'wrongVenue');
    outcome = { status: err.status, notice: err.body.message || err.body.fields.status, problem: true };
  }
  const ctx = await fleet(req.member);
  const truck = ctx.trucks.find((t) => t.id === req.params.truckId);
  return res.status(outcome.status).render('partials/fleet_update.njk', { ...ctx, truck, ...outcome });
}));

router.get('/admin/users', signedIn, wrap(async (req, res) => {
  res.render('members.njk', { title: 'Members', members: await listMembers(req.member) });
}));

router.patch('/admin/users/:memberId', signedIn, wrap(async (req, res) => {
  let outcome = { status: 200, notice: 'Role saved' };
  try {
    await setRole(req.member, req.params.memberId, { role: req.body.role });
  } catch (err) {
    if (!(err instanceof AppError) || err.status === 403) throw err;
    if (err.status === 404) return refusal(req, res, 'wrongVenue');
    outcome = { status: err.status, notice: err.body.message || err.body.fields.role, problem: true };
  }
  const m = await findMember(req.params.memberId);
  return res.status(outcome.status).render('partials/member_update.njk', { m, ...outcome });
}));

// ---------------------------------------------------------------- not found and failures
router.use((req, res) => refusal(req, res, 'wrongVenue'));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return refusal(req, res, 'tooLarge');
  if (err instanceof AppError && err.status === 403) return refusal(req, res, 'forbidden');
  if (err instanceof AppError && err.status === 404) return refusal(req, res, 'missing');
  console.log(`page ${req.method} ${req.path}: ${err && err.message}`);
  return refusal(req, res, 'unavailable');
});

module.exports = router;
