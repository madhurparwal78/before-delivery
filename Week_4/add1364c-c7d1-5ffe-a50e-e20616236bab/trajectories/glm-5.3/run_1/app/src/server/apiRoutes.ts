import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, notFound, writeError } from './errors.js';
import type { Store } from './store.js';
import { COPY, compileRoute, loadSession, matchRoute, readSessionCookie, type Route } from './apiCore.js';
import { mapPerson, type PersonRow } from './people.js';
import { getMe, getClock, getHealth, getEvents, listPeople, signOut } from './handlersCore.js';
import { createPerson, patchPerson, leavePerson, setTravel, cancelTravel } from './handlersPeopleApi.js';
import { signIn } from './handlersSignIn.js';
import { listVaults, getVault, createVault, patchVault } from './handlersVaults.js';
import { listVendors, createVendor, patchVendor, createCredential, getCredential } from './handlersVendors.js';
import { putSecret, revealCredential, copyCredential } from './handlersSecrets.js';
import { listRules, createRule, getRule, patchRule, signRule } from './handlersRules.js';
import { getAsOf } from './handlersAsOf.js';
import { createRotation, patchRotation, getRotation, getRotationCalendar } from './handlersRotations.js';
import { listReviews, getReview, decideReviewLine, signOffReview } from './handlersReviews.js';
import { getBilling } from './handlersBilling.js';
import { getHealthReport, runBreachCheck } from './handlersHealth.js';
import { createImport, getImport, chooseHeldName } from './handlersImports.js';
import { getAudit, getAuditFooter } from './handlersAudit.js';
import { SignInLockout } from './domain/sessions.js';

export interface Ctx {
  store: Store;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  person: PersonRow | null;
  sessionId: string | null;
  sessionEndsAt: Date | null;
  params: Record<string, string>;
}

const BODY_LIMIT = 16384;
const IMPORT_BODY_LIMIT = 1000000;

export function buildRoutes(store: Store): Route[] {
  const lockout = new SignInLockout(store.pool, store.settings.signInLockSeconds);
  const wrap = (handler: (ctx: Ctx) => Promise<void>) => handler;
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: (ctx: Ctx) => Promise<void>, publicRoute?: boolean) => {
    routes.push(compileRoute(method, path, wrap(handler), publicRoute));
  };

  add('POST', '/api/sessions', (ctx) => signIn(ctx, lockout), true);
  add('DELETE', '/api/sessions', signOut);
  add('GET', '/api/me', getMe);
  add('GET', '/api/clock', getClock, true);
  add('GET', '/api/health', getHealth, true);
  add('GET', '/api/events', getEvents);

  add('GET', '/api/people', listPeople);
  add('POST', '/api/people', createPerson);
  add('PATCH', '/api/people/{id}', patchPerson);
  add('POST', '/api/people/{id}/leave', leavePerson);
  add('POST', '/api/people/{id}/travel', setTravel);
  add('DELETE', '/api/people/{id}/travel/{travelId}', cancelTravel);

  add('GET', '/api/vaults', listVaults);
  add('GET', '/api/vaults/{id}', getVault);
  add('POST', '/api/vaults', createVault);
  add('PATCH', '/api/vaults/{id}', patchVault);
  add('GET', '/api/vendors', listVendors);
  add('POST', '/api/vendors', createVendor);
  add('PATCH', '/api/vendors/{id}', patchVendor);
  add('POST', '/api/credentials', createCredential);
  add('GET', '/api/credentials/{id}', getCredential);
  add('PUT', '/api/credentials/{id}/secret', putSecret);
  add('POST', '/api/credentials/{id}/reveal', revealCredential);
  add('POST', '/api/credentials/{id}/copy', copyCredential);

  add('GET', '/api/rules', listRules);
  add('POST', '/api/rules', createRule);
  add('GET', '/api/rules/{id}', getRule);
  add('PATCH', '/api/rules/{id}', patchRule);
  add('POST', '/api/rules/{id}/sign', signRule);
  add('GET', '/api/as-of', getAsOf);

  add('GET', '/api/rotations/calendar', getRotationCalendar);
  add('POST', '/api/rotations', createRotation);
  add('PATCH', '/api/rotations/{id}', patchRotation);
  add('GET', '/api/rotations/{id}', getRotation);

  add('GET', '/api/reviews', listReviews);
  add('GET', '/api/reviews/{id}', getReview);
  add('POST', '/api/reviews/{id}/lines/{lineId}', decideReviewLine);
  add('POST', '/api/reviews/{id}/sign-off', signOffReview);

  add('GET', '/api/billing', getBilling);

  add('GET', '/api/health-report', getHealthReport);
  add('POST', '/api/health-report/checks', runBreachCheck);

  add('POST', '/api/imports', createImport);
  add('GET', '/api/imports/{id}', getImport);
  add('POST', '/api/imports/{id}/rows/{row}/choice', chooseHeldName);

  add('GET', '/api/audit', getAudit);
  add('GET', '/api/audit/footer', getAuditFooter);

  return routes;
}

/** Dispatch with the one published precedence order. */
export async function dispatch(store: Store, routes: Route[], req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method === 'HEAD' ? 'GET' : req.method ?? 'GET';
  const pathname = url.pathname;
  const found = findRoute(routes, method, pathname);
  if (found === null) {
    // A write on a known audit path answers 405 method_not_allowed.
    if (pathname.startsWith('/api/audit') && method !== 'GET') {
      writeError(res, new ApiError(405, 'method_not_allowed', 'The audit trail is append-only.'));
      return;
    }
    writeError(res, notFound());
    return;
  }
  const { route, params } = found;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    // A write with a content type other than JSON answers 415.
    const contentType = req.headers['content-type'] ?? '';
    if (contentType !== '' && !contentType.startsWith('application/json')) {
      writeError(res, new ApiError(415, 'unsupported_media_type', 'Lockset accepts JSON requests only.'));
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const host = req.headers.host ?? 'localhost';
      const sameOrigin = origin === `http://${host}` || origin === `https://${host}`;
      if (!sameOrigin) {
        writeError(res, new ApiError(403, 'cross_origin', 'Lockset accepts requests from its own origin only.'));
        return;
      }
    }
  }
  let auth: { person: PersonRow; sessionEndsAt: Date; sessionEnded: boolean } | null = null;
  let sessionId: string | null = null;
  if (!route.publicRoute) {
    const cookie = readSessionCookie(req.headers.cookie ?? '');
    if (cookie === null) {
      writeError(res, new ApiError(401, 'signed_out', 'Sign in to use the drawer.'));
      return;
    }
    auth = await loadSession(store, cookie);
    if (auth === null) {
      writeError(res, new ApiError(401, 'signed_out', 'Sign in to use the drawer.'));
      return;
    }
    if (auth.sessionEnded) {
      writeError(res, new ApiError(401, 'session_ended', COPY.sessionEndedBody));
      return;
    }
    sessionId = cookie;
  }
  const ctx: Ctx = {
    store,
    req,
    res,
    url,
    method,
    person: auth?.person ?? null,
    sessionId,
    sessionEndsAt: auth?.sessionEndsAt ?? null,
    params
  };
  try {
    await route.handler(ctx as never);
  } catch (error) {
    if (error instanceof ApiError) {
      writeError(res, error);
      return;
    }
    console.error('unexpected api error', error instanceof Error ? error.message : String(error));
    writeError(res, new ApiError(500, 'internal', 'Something went wrong. Try again.'));
  }
}

function findRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const params = matchRoute(route, method, pathname);
    if (params !== null) return { route, params };
  }
  return null;
}
