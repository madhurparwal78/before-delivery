import express from 'express';
import { ApiError, iso, nowSeconds } from '../lib/core.js';
import { isOutage, pool, query, state, unavailable } from '../db.js';
import { ROLE, allows, forbidden, resolveCredential, signIn, signOut } from '../auth.js';
import * as admin from '../services/admin.js';
import * as intents from '../services/intents.js';
import { auditView as auditRowView, signedView, verifyChain } from '../services/audit.js';
import { INTENT_SELECT, intentViews } from '../services/views.js';
import { contactPage, errorPage, landingPage, loginPage, notFoundPage as notFoundView, pricingPage } from './public.js';
import * as views from './console.js';

const COOKIE = 'corvo_session';
const OUTAGE = "Corvo can't reach its database. Nothing was changed. Try again in a moment.";
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const send = (res, status, markup) => res.status(status).type('html').send(String(markup));

// ---------------------------------------------------------------- sessions, flash and answers
function sessionToken(req) {
  for (const part of (req.get('Cookie') || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const setCookie = (res, token, maxAge = '') => res.append('Set-Cookie',
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${maxAge}`);

// A same-origin path under /console, or nothing.
function safeNext(next) {
  if (typeof next !== 'string' || !/^\/console(?:[/?#]|$)/.test(next) || /[\\\s]/.test(next)) return null;
  return next;
}

const isFetch = (req) => req.get('X-Corvo-Fetch') === '1';
const toast = (text, kind = 'success') => ({ text, kind });

async function flash(req, value) {
  await query('UPDATE sessions SET flash = $2 WHERE id = $1', [req.caller.sessionId, JSON.stringify(value)]);
}

// A console write that worked: JSON for the page script, or a flash and a redirect for a plain document.
async function done(req, res, to, { note, result, ...extra }) {
  if (isFetch(req)) return res.json({ ok: true, toast: note || null, result: result || null, ...extra });
  await flash(req, { toast: note, result });
  return res.redirect(303, to);
}

const errorJson = (err) => ({ code: err.code, message: err.message, details: err.details || {} });

// A console write the server refused: JSON with the code, message and details, or the page drawn again.
function refused(req, res, err, rerender, result) {
  if (!(err instanceof ApiError)) throw err;
  if (isFetch(req)) return res.status(err.status).json({ ok: false, error: errorJson(err), result: result || null });
  return rerender(err);
}

async function attempt(req, res, work, rerender, result = () => null) {
  try {
    return await work();
  } catch (err) {
    return refused(req, res, err, rerender, result(err));
  }
}

// ---------------------------------------------------------------- the console frame
function requireMember() {
  return wrap(async (req, res, next) => {
    if (!state.ready) throw unavailable();
    const caller = await resolveCredential(sessionToken(req));
    if (!caller || caller.apiKey) {
      if (req.method !== 'GET') return res.redirect(303, '/login');
      return res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    req.caller = caller;
    if (req.method === 'POST' && req.body?._csrf !== caller.csrf) {
      throw new ApiError(403, 'FORBIDDEN_ROLE', 'This form expired. Reload the page and try again.');
    }
    if (req.method === 'GET' && caller.flash) {
      req.flash = caller.flash;
      await query('UPDATE sessions SET flash = NULL WHERE id = $1', [caller.sessionId]);
    }
    return next();
  });
}

async function frameOf(req, active) {
  const { caller } = req;
  return {
    me: caller.member, org: caller.org, csrf: caller.csrf, active,
    inboxCount: (await intents.inbox(caller)).length,
    canAudit: allows(caller, ROLE.auditors), isOwner: caller.role === 'owner', canMove: allows(caller, ROLE.movers),
    toast: req.flash?.toast || null,
  };
}

async function render(req, res, view, active, data, status = 200) {
  const frame = await frameOf(req, active);
  return send(res, status, view(frame, data));
}

async function names(orgId) {
  const [members, keys, policies, quorums] = await Promise.all([
    query('SELECT id, name FROM members WHERE organization_id = $1', [orgId]),
    query('SELECT id, name FROM api_keys WHERE organization_id = $1', [orgId]),
    query('SELECT id, name FROM policies WHERE organization_id = $1', [orgId]),
    query('SELECT id, name FROM key_quorums WHERE organization_id = $1 ORDER BY name', [orgId]),
  ]);
  const map = (r) => Object.fromEntries(r.rows.map((x) => [x.id, x.name]));
  return { members: { ...map(members), ...Object.fromEntries(keys.rows.map((k) => [k.id, `API key ${k.name}`])) },
    policies: map(policies), quorums: map(quorums), quorumList: quorums.rows };
}

// Adds what the console shows beside an intent: wallet name and asset, names, approvals so far.
async function decorate(caller, list) {
  const n = await names(caller.org.id);
  return list.map((i) => ({
    ...i, initiator: n.members[i.created_by] || i.created_by,
    approved: i.approvals.filter((a) => a.decision === 'approve').length,
    approvals: i.approvals.map((a) => ({ ...a, name: n.members[a.member_id] || a.member_id })),
    canCancel: i.status === 'pending_approval' && allows(caller, ROLE.movers)
      && (caller.role === 'owner' || i.created_by === caller.member.id),
  }));
}

async function intentExtras(list) {
  if (!list.length) return [];
  const { rows } = await query(`SELECT i.id, w.asset, w.name AS wallet_name FROM intents i JOIN wallets w ON w.id = i.wallet_id
     WHERE i.id IN (SELECT jsonb_array_elements_text($1::jsonb))`, [JSON.stringify(list.map((i) => i.id))]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  return list.map((i) => ({ ...i, asset: byId[i.id].asset, walletName: byId[i.id].wallet_name }));
}

const decorated = async (caller, list) => decorate(caller, await intentExtras(list));

// ---------------------------------------------------------------- forms that come back as text
function readBatchLines(body) {
  const lines = [];
  for (const [key, value] of Object.entries(body)) {
    const m = key.match(/^items\.(\d{1,3})\.(destination_address|amount|memo)$/);
    if (m && +m[1] < 100) (lines[+m[1]] ||= { destination_address: '', amount: '', memo: '' })[m[2]] = String(value);
  }
  return lines.filter(Boolean);
}

// The rule editor's flat fields: rule_count, r{i}_name, r{i}_method, r{i}_action, r{i}_cond_count, r{i}_c{j}_{part}.
function readEditor(b) {
  const count = Math.min(Number.parseInt(b.rule_count, 10) || 0, 60);
  return Array.from({ length: count }, (_, i) => {
    const conds = Math.min(Number.parseInt(b[`r${i}_cond_count`], 10) || 0, 30);
    const conditions = Array.from({ length: conds }, (__, j) => {
      const p = `r${i}_c${j}_`;
      const operator = b[`${p}operator`] ?? '';
      const raw = String(b[`${p}value`] ?? '').trim();
      return { field_source: b[`${p}field_source`] ?? '', field: String(b[`${p}field`] ?? '').trim(), operator,
        value: operator === 'in' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw };
    });
    return { name: String(b[`r${i}_name`] ?? ''), method: b[`r${i}_method`] ?? '', conditions, action: b[`r${i}_action`] ?? '' };
  });
}

function applyEdit(rules, op) {
  const [kind, a, b] = op.split(':');
  const i = Number.parseInt(a, 10);
  const j = Number.parseInt(b, 10);
  const next = rules.map((r) => ({ ...r, conditions: [...r.conditions] }));
  const swap = (list, x, y) => { if (list[x] && list[y]) [list[x], list[y]] = [list[y], list[x]]; };
  if (kind === 'add-rule') next.push({ name: '', method: 'transfer', conditions: [], action: 'ALLOW' });
  if (kind === 'remove-rule') next.splice(i, 1);
  if (kind === 'up') swap(next, i - 1, i);
  if (kind === 'down') swap(next, i, i + 1);
  if (kind === 'add-cond' && next[i]) {
    next[i].conditions.push({ field_source: 'request_body', field: 'destination.address', operator: 'eq', value: '' });
  }
  if (kind === 'remove-cond' && next[i]) next[i].conditions.splice(j, 1);
  return next;
}

// Hours on screen, seconds in the API: a value that is not a number reaches the API as is and is refused there.
const hoursToSeconds = (value) => (/^\d+(\.\d+)?$/.test(String(value ?? '').trim())
  ? Math.round(Number(value) * 3600) : value);
const integerOr = (value) => (/^\d+$/.test(String(value ?? '').trim()) ? Number(value) : value);
const renameField = (err, from, to) => {
  if (err instanceof ApiError && err.details?.field === from) err.details = { ...err.details, field: to };
  return err;
};

function batchResult(err) {
  if (err.code === 'POLICY_DENIED') {
    const k = err.details.index + 1;
    return err.details.rule ? `Line ${k} blocked by policy rule ${err.details.rule}` : `Line ${k} blocked by policy: no rule allowed it`;
  }
  return err.details?.field ? null : err.message;
}

// ---------------------------------------------------------------- router
export function webRouter() {
  const web = express.Router();
  web.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 5000 }));

  // ---- public site
  web.get('/', (req, res) => send(res, 200, landingPage()));
  web.get('/pricing', (req, res) => send(res, 200, pricingPage()));
  web.get('/contact', (req, res) => send(res, 200, contactPage({})));
  web.post('/contact', wrap(async (req, res) => {
    const fields = ['full_name', 'work_email', 'company', 'monthly_volume', 'message'];
    const body = Object.fromEntries(fields.map((f) => [f, typeof req.body[f] === 'string' ? req.body[f] : '']));
    const { refusals } = admin.contactRefusals(body);
    if (refusals.length) {
      const errors = Object.fromEntries(refusals.map((e) => [e.details.field, e.message]));
      return send(res, 422, contactPage({ values: body, errors }));
    }
    if (!state.ready) throw unavailable();
    await admin.createContact(body);
    return send(res, 201, contactPage({ sent: true }));
  }));

  web.get('/login', wrap(async (req, res) => {
    const next = safeNext(req.query.next) || '';
    if (state.ready && await resolveCredential(sessionToken(req))) return res.redirect(303, next || '/console');
    return send(res, 200, loginPage({ next }));
  }));
  web.post('/login', wrap(async (req, res) => {
    const next = safeNext(req.body.next) || '';
    const email = typeof req.body.email === 'string' ? req.body.email : '';
    try {
      if (!state.ready) throw unavailable();
      const session = await signIn({ email, password: typeof req.body.password === 'string' ? req.body.password : '' });
      setCookie(res, session.token);
      return res.redirect(303, next || '/console');
    } catch (err) {
      if (isOutage(err) || err.code === 'DATABASE_UNAVAILABLE') return send(res, 503, loginPage({ next, email, outage: true }));
      if (!(err instanceof ApiError)) throw err;
      return send(res, 401, loginPage({ next, email, error: 'Email or password is incorrect' }));
    }
  }));
  web.post('/logout', wrap(async (req, res) => {
    const caller = state.ready ? await resolveCredential(sessionToken(req)) : null;
    if (caller?.member && req.body._csrf === caller.csrf) await signOut(caller);
    setCookie(res, '', '; Max-Age=0');
    res.redirect(303, '/');
  }));

  // ---- console
  const c = express.Router();
  web.use('/console', requireMember(), c);
  const org = (req) => req.caller.org.id;
  const owner = (req) => { if (req.caller.role !== 'owner') throw forbidden(); };

  // Overview
  async function overview(req, res, create = {}, status = 200) {
    const orgId = org(req);
    const nowSec = nowSeconds();
    const [wallets, n, pending, executed, inbox] = await Promise.all([
      admin.listWallets(orgId), names(orgId),
      query('SELECT count(*)::int AS total FROM intents WHERE organization_id = $1 AND status = $2', [orgId, 'pending_approval']),
      query(`SELECT count(*)::int AS total FROM intents WHERE organization_id = $1 AND status = $4
               AND executed_at > to_timestamp($2) AND executed_at <= to_timestamp($3)`, [orgId, nowSec - 86400, nowSec, 'executed']),
      intents.inbox(req.caller)]);
    const policies = Object.entries(n.policies).map(([id, name]) => ({ id, name }));
    return render(req, res, views.overviewView, 'overview', {
      wallets, names: n, policies, quorums: n.quorumList, create,
      stats: { wallets: wallets.length, pending: pending.rows[0].total, awaiting: inbox.length, executed: executed.rows[0].total },
    }, status);
  }
  c.get('/', wrap((req, res) => overview(req, res, req.query.create === '1' ? { open: true } : {})));
  c.post('/wallets', wrap(async (req, res) => {
    const values = { name: req.body.name ?? '', chain: req.body.chain ?? '', asset: req.body.asset ?? '',
      approval_floor: req.body.approval_floor ?? '', policy_id: req.body.policy_id ?? '', quorum_id: req.body.quorum_id ?? '' };
    return attempt(req, res, async () => {
      owner(req);
      const body = { name: values.name, chain: values.chain, asset: values.asset };
      if (values.approval_floor !== '') body.approval_floor = values.approval_floor;
      if (values.policy_id) body.policy_id = values.policy_id;
      if (values.quorum_id) body.quorum_id = values.quorum_id;
      await admin.createWallet(req.caller, body);
      return done(req, res, '/console', { note: toast('Wallet created') });
    }, (err) => overview(req, res, { open: true, values, error: err }, err.status));
  }));

  // Wallet page
  async function walletPage(req, res, forms = {}, status = 200) {
    let wallet;
    try {
      wallet = await admin.getWallet(org(req), req.params.id);
    } catch (err) {
      if (err.code === 'WALLET_NOT_FOUND') return notFound(req, res);
      throw err;
    }
    const n = await names(org(req));
    const [list, deposits] = await Promise.all([
      query(`${INTENT_SELECT} WHERE i.wallet_id = $1 ORDER BY i.created_at DESC, i.id COLLATE "C" DESC LIMIT 50`, [wallet.id]),
      query('SELECT * FROM deposits WHERE wallet_id = $1 ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT 50', [wallet.id]),
    ]);
    const activity = [
      ...(await intentViews(pool, list.rows)).map((v) => ({ type: 'intent', at: v.created_at, id: v.id, intent: v })),
      ...deposits.rows.map((d) => ({ type: 'deposit', at: iso(d.created_at), id: d.id, deposit: d, by: n.members[d.created_by] || d.created_by })),
    ].sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : (a.at < b.at ? 1 : -1))).slice(0, 50);
    const flashed = req.flash?.result ? { [req.flash.result.form]: { result: req.flash.result } } : {};
    return render(req, res, views.walletPageView, 'overview', {
      wallet, policyName: n.policies[wallet.policy_id] || null, quorumName: n.quorums[wallet.quorum_id] || null,
      activity, confirm: req.query.confirm === 'freeze', forms: { ...flashed, ...forms } }, status);
  }
  c.get('/wallets/:id', wrap((req, res) => walletPage(req, res)));
  const back = (req) => `/console/wallets/${encodeURIComponent(req.params.id)}`;

  c.post('/wallets/:id/send', wrap(async (req, res) => {
    const values = { destination_address: req.body.destination_address ?? '', amount: req.body.amount ?? '', memo: req.body.memo ?? '' };
    return attempt(req, res, async () => {
      if (!allows(req.caller, ROLE.movers)) throw forbidden();
      const body = { destination_address: values.destination_address, amount: values.amount };
      if (values.memo !== '') body.memo = values.memo;
      const answer = await intents.transfer(req.caller, req.params.id, body, null);
      const parsed = JSON.parse(answer.body);
      if (!parsed.success) {
        const e = parsed.error;
        throw new ApiError(answer.status, e.code, e.message, e.details);
      }
      const intent = parsed.data;
      const text = intent.status === 'executed' ? 'Transfer executed'
        : `Waiting for approval: 0 of ${intent.required_approvals} approvals`;
      return done(req, res, back(req), { note: intent.status === 'executed' ? toast(text) : null,
        result: { form: 'send', text, kind: 'success' } });
    }, (err) => walletPage(req, res, { send: { values, error: err, result: err.details?.field ? null : { text: err.message, kind: 'error' } } }, err.status),
    (err) => (err.details?.field ? null : { form: 'send', text: err.message, kind: 'error' }));
  }));

  c.post('/wallets/:id/deposit', wrap(async (req, res) => {
    const values = { amount: req.body.amount ?? '', reference: req.body.reference ?? '' };
    return attempt(req, res, async () => {
      if (!allows(req.caller, ROLE.movers)) throw forbidden();
      await intents.deposit(req.caller, req.params.id, values, null);
      return done(req, res, back(req), { note: toast('Deposit recorded') });
    }, (err) => walletPage(req, res, { deposit: { values, error: err, result: err.details?.field ? null : { text: err.message, kind: 'error' } } }, err.status),
    (err) => (err.details?.field ? null : { form: 'deposit', text: err.message, kind: 'error' }));
  }));

  c.post('/wallets/:id/batch', wrap(async (req, res) => {
    let lines = readBatchLines(req.body);
    const op = String(req.body.op || 'submit');
    if (op === 'add' || op.startsWith('remove:')) {
      if (op === 'add' && lines.length < 100) lines.push({ destination_address: '', amount: '', memo: '' });
      if (op.startsWith('remove:') && lines.length > 1) lines = lines.filter((_, i) => i !== Number(op.split(':')[1]));
      return walletPage(req, res, { batch: { lines } });
    }
    return attempt(req, res, async () => {
      if (!allows(req.caller, ROLE.movers)) throw forbidden();
      const answer = await intents.batch(req.caller, req.params.id, { items: lines }, null);
      const parsed = JSON.parse(answer.body);
      if (!parsed.success) {
        const e = parsed.error;
        throw new ApiError(answer.status, e.code, e.message, e.details);
      }
      const intent = parsed.data;
      const text = intent.status === 'executed' ? 'Batch executed'
        : `Batch waiting for approval: 0 of ${intent.required_approvals} approvals`;
      return done(req, res, back(req), { note: intent.status === 'executed' ? toast(text) : null,
        result: { form: 'batch', text, kind: 'success' } });
    }, (err) => walletPage(req, res, { batch: { lines, error: err, result: batchResult(err) ? { text: batchResult(err), kind: 'error' } : null } }, err.status),
    (err) => (batchResult(err) ? { form: 'batch', text: batchResult(err), kind: 'error' } : null));
  }));

  for (const [verb, frozen] of [['freeze', true], ['unfreeze', false]]) {
    c.post(`/wallets/:id/${verb}`, wrap(async (req, res) => attempt(req, res, async () => {
      owner(req);
      await admin.setFrozen(req.caller, req.params.id, frozen);
      return done(req, res, back(req), { note: toast(frozen ? 'Wallet frozen' : 'Wallet unfrozen') });
    }, () => walletPage(req, res, {}, 409))));
  }

  // Approvals inbox and decisions
  async function approvalsPage(req, res, rowError = null, status = 200) {
    const items = await decorated(req.caller, await intents.inbox(req.caller));
    return render(req, res, views.approvalsView, 'approvals', { items, rowError }, status);
  }
  c.get('/approvals', wrap((req, res) => approvalsPage(req, res)));
  for (const decision of ['approve', 'reject']) {
    c.post(`/intents/:id/${decision}`, wrap(async (req, res) => attempt(req, res, async () => {
      const body = decision === 'reject' ? { reason: req.body.reason ?? '' } : {};
      const intent = await intents.decideIntent(req.caller, req.params.id, decision, body);
      const approved = intent.approvals.filter((a) => a.decision === 'approve').length;
      let text = 'Intent rejected';
      if (decision === 'approve') {
        text = intent.status === 'executed' ? `${intent.kind === 'batch' ? 'Batch' : 'Transfer'} executed`
          : `Approved: ${approved} of ${intent.required_approvals} approvals`;
      }
      return done(req, res, '/console/approvals', { note: toast(text), approved, required: intent.required_approvals });
    }, (err) => approvalsPage(req, res, { id: req.params.id, message: err.message }, err.status))));
  }
  c.post('/intents/:id/cancel', wrap(async (req, res) => attempt(req, res, async () => {
    if (!allows(req.caller, ROLE.movers)) throw forbidden();
    await intents.cancelIntent(req.caller, req.params.id);
    return done(req, res, '/console/intents', { note: toast('Intent cancelled') });
  }, (err) => intentsPage(req, res, err.status))));

  // Intents list
  async function intentsPage(req, res, status = 200) {
    const filter = intents.STATUSES.includes(req.query.status) ? req.query.status : '';
    const q = filter ? { status: filter } : {};
    let page;
    try {
      page = await intents.listIntents(req.caller, typeof req.query.cursor === 'string' ? { ...q, cursor: req.query.cursor } : q);
    } catch (err) {
      if (err.code !== 'INVALID_CURSOR') throw err;
      page = await intents.listIntents(req.caller, q);
    }
    return render(req, res, views.intentsView, 'intents', {
      items: await decorated(req.caller, page.items), status: filter,
      next: page.next_cursor ? { ...(filter ? { status: filter } : {}), cursor: page.next_cursor } : null }, status);
  }
  c.get('/intents', wrap((req, res) => intentsPage(req, res)));
  c.get('/intents/export', wrap(async (req, res) => {
    const filter = intents.STATUSES.includes(req.query.status) ? { status: req.query.status } : {};
    const csv = await intents.exportCsv(req.caller, filter);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="corvo-intents.csv"' });
    res.send(csv);
  }));

  // Policies
  c.get('/policies', wrap(async (req, res) => {
    const [policies, wallets] = await Promise.all([admin.listPolicies(org(req)), admin.listWallets(org(req))]);
    return render(req, res, views.policiesView, 'policies', {
      policies: policies.map((p) => ({ ...p, wallets: wallets.filter((w) => w.policy_id === p.id).map((w) => w.name) })) });
  }));
  async function policyPage(req, res, extra = {}, status = 200) {
    let policy;
    try {
      policy = await admin.getPolicy(org(req), req.params.id);
    } catch (err) {
      if (err.code === 'POLICY_NOT_FOUND') return notFound(req, res);
      throw err;
    }
    const [wallets, aggregations, revisions] = await Promise.all([admin.listWallets(org(req)), admin.listAggregations(org(req)),
      admin.listRevisions(org(req), policy.id)]);
    return render(req, res, views.policyPageView, 'policies', { policy, rules: extra.rules || policy.rules, wallets,
      aggregations, revisions, sim: extra.sim || { values: { wallet_id: wallets[0]?.id } }, saveError: extra.saveError }, status);
  }
  c.get('/policies/:id', wrap((req, res) => policyPage(req, res)));
  c.post('/policies/:id', wrap(async (req, res) => {
    const rules = readEditor(req.body);
    const op = String(req.body.op || 'save');
    if (op !== 'save') return policyPage(req, res, { rules: applyEdit(rules, op) });
    return attempt(req, res, async () => {
      owner(req);
      const saved = await admin.updatePolicy(req.caller, req.params.id, { rules });
      return done(req, res, `/console/policies/${encodeURIComponent(req.params.id)}`, { note: toast(`Policy saved, revision ${saved.revision}`) });
    }, (err) => policyPage(req, res, { rules, saveError: err }, err.status));
  }));
  c.post('/policies/:id/simulate', wrap(async (req, res) => {
    const values = { method: req.body.method ?? '', wallet_id: req.body.wallet_id ?? '',
      destination_address: req.body.destination_address ?? '', amount: req.body.amount ?? '' };
    try {
      const result = await admin.evaluatePolicy(req.caller, req.params.id, values);
      return policyPage(req, res, { sim: { values, result } });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return policyPage(req, res, { sim: { values, error: err } }, err.status);
    }
  }));

  // Quorums and aggregations
  async function quorumsPage(req, res, extra = {}, status = 200) {
    const orgId = org(req);
    const [quorums, aggregations, policies, wallets, members] = await Promise.all([admin.listQuorums(orgId),
      admin.listAggregations(orgId), admin.listPolicies(orgId), admin.listWallets(orgId), admin.listMembers(orgId)]);
    const memberName = Object.fromEntries(members.map((m) => [m.id, m.name]));
    return render(req, res, views.quorumsView, 'quorums', {
      quorums: quorums.map((q) => ({ ...q, names: q.member_ids.map((id) => memberName[id] || id),
        wallets: wallets.filter((w) => w.quorum_id === q.id).map((w) => w.name) })),
      aggregations: aggregations.map((a) => ({ ...a,
        policies: policies.filter((p) => JSON.stringify(p.rules).includes(`"aggregation.${a.id}"`)).map((p) => p.name) })),
      signers: members.filter((m) => ['owner', 'approver'].includes(m.role)), ...extra }, status);
  }
  c.get('/quorums', wrap((req, res) => quorumsPage(req, res)));
  const quorumBody = (b) => ({ name: b.name ?? '', member_ids: [].concat(b.member_ids || []),
    authorization_threshold: integerOr(b.authorization_threshold), expiry_seconds: hoursToSeconds(b.expiry_hours) });
  const quorumValues = (b) => ({ name: b.name, member_ids: [].concat(b.member_ids || []),
    authorization_threshold: b.authorization_threshold, expiry_hours: b.expiry_hours });
  c.post('/quorums', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    await admin.createQuorum(req.caller, quorumBody(req.body));
    return done(req, res, '/console/quorums', { note: toast('Key quorum saved') });
  }, (err) => quorumsPage(req, res, { quorumForm: { open: true, values: quorumValues(req.body),
    error: renameField(err, 'expiry_seconds', 'expiry_hours') } }, err.status))));
  c.post('/quorums/:id', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    await admin.updateQuorum(req.caller, req.params.id, quorumBody(req.body));
    return done(req, res, '/console/quorums', { note: toast('Key quorum saved') });
  }, (err) => quorumsPage(req, res, { editForm: { id: req.params.id, values: quorumValues(req.body),
    error: renameField(err, 'expiry_seconds', 'expiry_hours') } }, err.status))));
  c.post('/aggregations', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    await admin.createAggregation(req.caller, { name: req.body.name ?? '', metric: req.body.metric ?? '',
      window_seconds: hoursToSeconds(req.body.window_hours), asset: req.body.asset ?? '', group_by: req.body.group_by || 'wallet' });
    return done(req, res, '/console/quorums', { note: toast('Aggregation created') });
  }, (err) => quorumsPage(req, res, { aggForm: { open: true, values: req.body, error: renameField(err, 'window_seconds', 'window_hours') } },
    err.status))));

  // Audit
  c.get('/audit', wrap(async (req, res) => {
    if (!allows(req.caller, ROLE.auditors)) {
      return render(req, res, views.messageView, 'audit', { title: 'No access', heading: 'You do not have access to this page',
        text: 'The audit trail and the signed event log are open to owners and auditors.' }, 403);
    }
    const [chain, events, signed] = await Promise.all([verifyChain(pool, org(req)),
      query('SELECT * FROM audit_events WHERE organization_id = $1 ORDER BY seq DESC LIMIT 200', [org(req)]),
      query('SELECT * FROM webhook_events WHERE organization_id = $1 ORDER BY seq DESC LIMIT 200', [org(req)])]);
    return render(req, res, views.auditView, 'audit', { chain, events: events.rows.map(auditRowView), total: chain.events,
      signed: signed.rows.map(signedView), tab: req.query.tab === 'signed' ? 'signed' : 'trail' });
  }));
  c.post('/audit/verify', wrap(async (req, res) => {
    if (!allows(req.caller, ROLE.auditors)) throw forbidden();
    const chain = await verifyChain(pool, org(req));
    if (isFetch(req)) return res.json({ ok: true, chain: { ...chain, text: views.chainLine(chain) } });
    return res.redirect(303, '/console/audit');
  }));

  // Settings
  async function settingsPage(req, res, extra = {}, status = 200) {
    const orgId = org(req);
    const isOwner = req.caller.role === 'owner';
    const readsKeys = allows(req.caller, ROLE.auditors);
    const [members, keys, secret] = await Promise.all([admin.listMembers(orgId), readsKeys ? admin.listKeys(orgId) : [],
      isOwner ? admin.readSecret(orgId) : null]);
    const memberName = Object.fromEntries(members.map((m) => [m.id, m.name]));
    return render(req, res, views.settingsView, 'settings', {
      members, keys: keys.map((k) => ({ ...k, creator: memberName[k.created_by] || 'Removed member' })),
      secret: secret?.secret, reveal: isOwner && req.query.reveal === '1', confirmRemove: req.query.remove, ...extra }, status);
  }
  c.get('/settings', wrap(async (req, res) => {
    if (isFetch(req) && req.query.reveal === '1') {
      owner(req);
      return res.json({ ok: true, secret: (await admin.readSecret(org(req))).secret });
    }
    return settingsPage(req, res);
  }));
  c.post('/members', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    await admin.createMember(req.caller, { name: req.body.name ?? '', email: req.body.email ?? '', role: req.body.role ?? '',
      password: req.body.password ?? '' });
    return done(req, res, '/console/settings', { note: toast('Member added') });
  }, (err) => settingsPage(req, res, { memberForm: { open: true, values: { ...req.body, password: '' }, error: err } }, err.status))));
  c.post('/members/:id/role', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    await admin.updateMember(req.caller, req.params.id, { role: req.body.role ?? '' });
    return done(req, res, '/console/settings', { note: toast('Member updated') });
  }, (err) => settingsPage(req, res, { rowError: { id: req.params.id, message: err.message } }, err.status))));
  c.post('/members/:id/remove', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    await admin.removeMember(req.caller, req.params.id);
    return done(req, res, '/console/settings', { note: toast('Member removed') });
  }, (err) => settingsPage(req, res, { rowError: { id: req.params.id, message: err.message } }, err.status))));
  // The new secret shows once, in this answer only.
  c.post('/api-keys', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    const made = await admin.createKey(req.caller, { name: req.body.name ?? '', role: req.body.role ?? '' });
    req.flash = { toast: toast('API key created') };
    return settingsPage(req, res, { newKey: made }, 201);
  }, (err) => settingsPage(req, res, { keyForm: { values: req.body, error: err } }, err.status))));
  c.post('/api-keys/:id/revoke', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    await admin.revokeKey(req.caller, req.params.id);
    return done(req, res, '/console/settings', { note: toast('API key revoked') });
  }, (err) => settingsPage(req, res, {}, err.status))));
  c.post('/webhooks/rotate', wrap(async (req, res) => attempt(req, res, async () => {
    owner(req);
    await admin.rotateSecret(req.caller);
    return done(req, res, '/console/settings', { note: toast('Signing secret rotated') });
  }, (err) => settingsPage(req, res, {}, err.status))));

  c.use((req, res) => notFound(req, res));
  return web;
}

// ---------------------------------------------------------------- not found and errors
async function notFound(req, res) {
  if (req.caller) {
    return render(req, res, views.messageView, '', { title: 'Not found', heading: 'Not found',
      text: 'Nothing with that id exists in your organization.' }, 404);
  }
  return send(res, 404, notFoundView());
}

export function notFoundPage(req, res) {
  send(res, 404, notFoundView());
}

export function pageErrors(err, req, res, next) { // eslint-disable-line no-unused-vars
  const outage = isOutage(err) || err.code === 'DATABASE_UNAVAILABLE';
  if (isFetch(req)) {
    if (outage) return res.status(503).json({ ok: false, error: errorJson(unavailable()) });
    if (err instanceof ApiError) return res.status(err.status).json({ ok: false, error: errorJson(err) });
  }
  if (outage) {
    return send(res, 503, errorPage({ heading: 'Corvo is reconnecting', text: OUTAGE, toast: { text: OUTAGE, kind: 'error' } }));
  }
  if (err instanceof ApiError) return send(res, err.status, errorPage({ heading: 'This request was refused', text: err.message }));
  if (err.status === 404 || err.statusCode === 404) return send(res, 404, notFoundView());
  if (err.type === 'entity.too.large') return send(res, 413, errorPage({ heading: 'Too large', text: 'This form sent more than the server accepts.' }));
  console.error(err);
  return send(res, 500, errorPage({ heading: 'Something went wrong', text: 'The request could not be completed. Try again in a moment.' }));
}
