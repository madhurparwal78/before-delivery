import { checkContact, login } from '../api/auth.js';
import { exportIntents } from '../api/intents.js';
import { DatabaseUnavailableError, query } from '../db/pool.js';
import { hashSecret } from '../domain/credentials.js';
import { resolvePrincipal } from '../http/auth.js';
import { ApiError } from '../http/errors.js';
import { decodeCursor, encodeCursor } from '../http/cursor.js';
import { denialMessage, runAction } from './actions.js';
import {
  auditData, awaitingCount, inboxData, intentsPageData, overviewData, policiesData, policyPageData,
  quorumsData, settingsData, walletPageData
} from './data.js';
import { DATABASE_OUTAGE, NOT_FOUND_TEXT } from './messages.js';
import { consolePage, publicPage } from './layout.js';
import { renderLanding } from './pages/landing.js';
import { renderPricing } from './pages/pricing.js';
import { renderContact } from './pages/contact.js';
import { renderLogin, renderNotFound, WRONG_PAIR_MESSAGE } from './pages/login.js';
import { renderOverview } from './pages/console/overview.js';
import { renderWallet } from './pages/console/wallet.js';
import { renderApprovals } from './pages/console/approvals.js';
import { intentRows, renderIntents } from './pages/console/intents.js';
import { renderPolicies, renderPolicy, renderSimulation } from './pages/console/policies.js';
import { renderQuorums } from './pages/console/quorums.js';
import { chainStatusLine, renderAudit, renderNoAccess } from './pages/console/audit.js';
import { renderSettings } from './pages/console/settings.js';
import { h } from './html.js';

const SESSION_COOKIE = 'corvo_session';

function sendHtml(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(body);
}

function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(body);
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...headers });
  response.end();
}

function readCookies(header) {
  const jar = {};
  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

async function readSession(request) {
  const token = readCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const principal = await resolvePrincipal(token);
  if (!principal || principal.type !== 'member') return null;
  return { token, principal, member: principal.member, organization: principal.organization };
}

function formBody(rawBody) {
  return new URLSearchParams(rawBody.toString('utf8'));
}

function isEnhanced(request) {
  return request.headers['x-corvo-enhanced'] === '1';
}

function flashes(url) {
  const flash = url.searchParams.get('flash');
  return flash ? [flash.slice(0, 160)] : [];
}

/** `next` is honoured only for same-origin console paths. */
export function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/console') || value.startsWith('//')) return '/console';
  return value;
}

function outagePage() {
  return publicPage({
    title: 'Corvo is reconnecting',
    description: 'Corvo cannot reach its database.',
    content: `<section><div class="shell"><h1>Corvo is reconnecting</h1><p class="alert" role="alert">${h(DATABASE_OUTAGE)}</p></div></section>`
  });
}

async function consoleShell(session) {
  return awaitingCount(session.organization.id, session.member.id);
}

async function renderConsolePage(path, { session, url, extra = {} }) {
  const toasts = flashes(url);
  const awaiting = await consoleShell(session);

  if (path === '/console') {
    return renderOverview({ session, data: await overviewData(session), toasts });
  }
  if (path === '/console/approvals') {
    return renderApprovals({ session, data: await inboxData(session), toasts });
  }
  if (path === '/console/intents') {
    const status = url.searchParams.get('status') || '';
    const rawCursor = url.searchParams.get('cursor');
    const cursor = rawCursor
      ? decodeCursor(rawCursor, { organizationId: session.organization.id, status, walletId: null }, session.organization.webhook_secret)
      : null;
    const data = await intentsPageData(session, { status, cursor });
    const last = data.rows[data.rows.length - 1];
    const nextCursor = data.hasMore && last
      ? encodeCursor(
        { organizationId: session.organization.id, status, walletId: null, createdAt: last.created_at, id: last.id },
        session.organization.webhook_secret
      )
      : null;
    return renderIntents({ session, data, toasts, awaiting, status, nextCursor });
  }
  if (path === '/console/policies') {
    return renderPolicies({ session, data: await policiesData(session), toasts, awaiting });
  }
  if (path.startsWith('/console/policies/')) {
    const data = await policyPageData(session, path.slice('/console/policies/'.length));
    if (!data) return null;
    return renderPolicy({ session, data: { ...data, simulation: extra.simulation }, toasts, awaiting });
  }
  if (path.startsWith('/console/wallets/')) {
    const data = await walletPageData(session, path.slice('/console/wallets/'.length));
    if (!data) return null;
    return renderWallet({ session, data, toasts, awaiting });
  }
  if (path === '/console/quorums') {
    return renderQuorums({ session, data: await quorumsData(session), toasts, awaiting });
  }
  if (path === '/console/audit') {
    if (!['owner', 'auditor'].includes(session.member.role)) return renderNoAccess({ session, toasts, awaiting });
    return renderAudit({ session, data: await auditData(session), toasts, awaiting });
  }
  if (path === '/console/settings') {
    return renderSettings({ session, data: await settingsData(session), toasts, awaiting });
  }
  return null;
}

function notFoundResponse(response) {
  sendHtml(response, 404, renderNotFound());
}

function consoleNotFound(response, session, awaiting) {
  sendHtml(response, 404, consolePage({
    title: 'Not found — Corvo console',
    session,
    active: '/console',
    awaiting,
    content: `<h1>${h(NOT_FOUND_TEXT)}</h1><p><a href="/console">Back to the console</a></p>`
  }));
}

async function handleConsoleAction({ request, response, url, rawBody, session }) {
  const form = formBody(rawBody);
  const name = form.get('__action') || '';
  const context = {
    walletId: url.pathname.startsWith('/console/wallets/') ? url.pathname.slice('/console/wallets/'.length) : null,
    policyId: url.pathname.startsWith('/console/policies/') ? url.pathname.slice('/console/policies/'.length) : null
  };

  try {
    const outcome = await runAction(name, session, form, context);
    if (isEnhanced(request)) {
      sendJson(response, 200, {
        ok: true,
        toast: outcome.toast || null,
        result: outcome.result || null,
        view: outcome.view || null,
        chainStatus: outcome.view && outcome.view.chain ? chainStatusLine(outcome.view.chain) : null,
        simulationHtml: outcome.view && outcome.view.simulation ? renderSimulation(outcome.view.simulation) : null
      });
      return;
    }
    if (outcome.view && outcome.view.simulation) {
      const body = await renderConsolePage(url.pathname, { session, url, extra: { simulation: outcome.view.simulation } });
      sendHtml(response, 200, body);
      return;
    }
    const target = outcome.toast
      ? `${url.pathname}?flash=${encodeURIComponent(outcome.toast)}`
      : url.pathname;
    redirect(response, target);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      if (isEnhanced(request)) {
        sendJson(response, 503, { ok: false, code: 'DATABASE_UNAVAILABLE', message: DATABASE_OUTAGE, details: {} });
        return;
      }
      sendHtml(response, 503, outagePage());
      return;
    }
    if (!(error instanceof ApiError)) throw error;
    const payload = {
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details || {},
      result: null
    };
    if (error.code === 'POLICY_DENIED') {
      payload.result = denialMessage(error, { batch: name === 'batch' });
    } else if (['INSUFFICIENT_FUNDS'].includes(error.code) && ['send', 'batch'].includes(name)) {
      payload.result = error.message;
    }
    if (isEnhanced(request)) {
      sendJson(response, error.status, payload);
      return;
    }
    redirect(response, `${url.pathname}?flash=${encodeURIComponent(payload.result || error.message)}`);
  }
}

async function handleIntentsPartial({ response, url, session }) {
  const status = url.searchParams.get('status') || '';
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor
    ? decodeCursor(rawCursor, { organizationId: session.organization.id, status, walletId: null }, session.organization.webhook_secret)
    : null;
  const data = await intentsPageData(session, { status, cursor });
  const last = data.rows[data.rows.length - 1];
  const nextCursor = data.hasMore && last
    ? encodeCursor(
      { organizationId: session.organization.id, status, walletId: null, createdAt: last.created_at, id: last.id },
      session.organization.webhook_secret
    )
    : null;
  sendJson(response, 200, {
    ok: true,
    rows: intentRows(data.items, { assets: data.assets, walletNames: data.walletNames, names: data.names, session }),
    next_cursor: nextCursor
  });
}

export async function handlePageRequest({ request, response, url, rawBody }) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (request.method === 'GET' && path === '/') return sendHtml(response, 200, renderLanding());
    if (request.method === 'GET' && path === '/pricing') return sendHtml(response, 200, renderPricing());

    if (path === '/contact') {
      if (request.method === 'GET') return sendHtml(response, 200, renderContact());
      if (request.method === 'POST') {
        const form = formBody(rawBody);
        const values = {
          full_name: form.get('full_name') || '',
          work_email: form.get('work_email') || '',
          company: form.get('company') || '',
          monthly_volume: form.get('monthly_volume') || '',
          message: form.get('message') || ''
        };
        const { errors } = checkContact(values);
        if (errors.length) {
          if (isEnhanced(request)) return sendJson(response, 422, { ok: false, errors });
          return sendHtml(response, 200, renderContact({ values, errors }));
        }
        await runAction('contact', null, form);
        if (isEnhanced(request)) return sendJson(response, 201, { ok: true });
        return sendHtml(response, 200, renderContact({ sent: true }));
      }
    }

    if (path === '/login') {
      if (request.method === 'GET') {
        const session = await readSession(request);
        if (session) return redirect(response, safeNext(url.searchParams.get('next')));
        return sendHtml(response, 200, renderLogin({ next: url.searchParams.get('next') || '' }));
      }
      if (request.method === 'POST') {
        const form = formBody(rawBody);
        const email = form.get('email') || '';
        const next = safeNext(form.get('next'));
        try {
          const answer = await login({ body: { email, password: form.get('password') || '' } });
          if (isEnhanced(request)) {
            return sendJson(response, 200, { ok: true, redirect: next }, { 'Set-Cookie': sessionCookie(answer.data.token) });
          }
          return redirect(response, next, { 'Set-Cookie': sessionCookie(answer.data.token) });
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          if (isEnhanced(request)) return sendJson(response, error.status, { ok: false, message: WRONG_PAIR_MESSAGE });
          return sendHtml(response, 200, renderLogin({ email, error: WRONG_PAIR_MESSAGE, next: form.get('next') || '' }));
        }
      }
    }

    if (path === '/console/signout' && request.method === 'POST') {
      const session = await readSession(request);
      if (session) await query('DELETE FROM sessions WHERE token_hash = $1', [hashSecret(session.token)]);
      return redirect(response, '/', { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    }

    if (path === '/console' || path.startsWith('/console/')) {
      const session = await readSession(request);
      if (!session) {
        return redirect(response, `/login?next=${encodeURIComponent(path)}`);
      }
      if (path === '/console/intents/export' && request.method === 'GET') {
        const answer = await exportIntents({
          organization: session.organization,
          principal: session.principal,
          params: {},
          query: url.searchParams,
          body: {},
          headers: {}
        });
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="corvo-intents.csv"',
          'Content-Length': Buffer.byteLength(answer.csv),
          'Cache-Control': 'no-store'
        });
        return response.end(answer.csv);
      }
      if (path === '/console/intents' && request.method === 'GET' && url.searchParams.get('partial') === 'rows') {
        return handleIntentsPartial({ response, url, session });
      }
      if (request.method === 'POST') {
        return handleConsoleAction({ request, response, url, rawBody, session });
      }
      if (request.method === 'GET') {
        const body = await renderConsolePage(path, { session, url });
        if (!body) return consoleNotFound(response, session, await consoleShell(session));
        return sendHtml(response, 200, body);
      }
    }

    return notFoundResponse(response);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return sendHtml(response, 503, outagePage());
    if (error instanceof ApiError) return sendHtml(response, error.status === 404 ? 404 : 400, renderNotFound());
    process.stderr.write(`page error: ${error && error.stack ? error.stack : error}\n`);
    return sendHtml(response, 500, renderNotFound());
  }
}
