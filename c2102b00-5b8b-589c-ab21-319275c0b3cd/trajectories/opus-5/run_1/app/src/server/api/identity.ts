import { writeTx } from '../db.ts';
import { invalidCode, validation } from '../http/errors.ts';
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  personByAccessCode,
  sessionCookie,
} from '../http/session.ts';
import { jsonBody, requireRole, requireSession, type ApiResult, type RequestContext } from '../http/context.ts';
import { getClub, listProducts } from '../store.ts';
import * as killbill from '../providers/killbill.ts';

function identityBody(name: string, role: string, householdCode: string | null): Record<string, unknown> {
  return { role, name, household_code: householdCode };
}

export function health(): ApiResult {
  return { status: 200, body: { status: 'ok' } };
}

export function signIn(ctx: RequestContext): ApiResult {
  const body = jsonBody(ctx);
  const code = body.code;
  if (typeof code !== 'string' || code.length === 0) {
    throw validation({ code: 'Enter your access code.' });
  }
  const person = personByAccessCode(code);
  if (!person) throw invalidCode();
  const sessionId = writeTx(() => createSession(person.id));
  return {
    status: 200,
    body: identityBody(person.name, person.role, person.household_code),
    cookies: [sessionCookie(sessionId)],
  };
}

export function signOut(ctx: RequestContext): ApiResult {
  const session = requireSession(ctx);
  writeTx(() => destroySession(session.id));
  return { status: 204, cookies: [clearedSessionCookie()] };
}

export function me(ctx: RequestContext): ApiResult {
  const session = requireSession(ctx);
  return {
    status: 200,
    body: identityBody(session.viewer.name, session.viewer.role, session.viewer.householdCode),
  };
}

export function club(ctx: RequestContext): ApiResult {
  requireSession(ctx);
  const row = getClub();
  return { status: 200, body: { name: row.name, time_zone: row.time_zone, distributor: row.distributor } };
}

export function catalog(ctx: RequestContext): ApiResult {
  requireRole(ctx, ['coordinator']);
  return {
    status: 200,
    body: {
      products: listProducts().map((product) => ({
        id: product.id,
        case_name: product.case_name,
        pack: product.pack,
        unit: product.unit,
        price_cents: product.price_cents,
      })),
    },
  };
}

interface PaymentsProbe {
  checkedAt: number;
  available: boolean;
}

let probe: PaymentsProbe | null = null;
const PROBE_TTL_MS = 2000;

/** The payments status, from a check made no more than two seconds earlier. */
export async function paymentsStatus(ctx: RequestContext): Promise<ApiResult> {
  requireSession(ctx);
  if (!probe || Date.now() - probe.checkedAt > PROBE_TTL_MS) {
    const available = await killbill.ping(2000);
    probe = { checkedAt: Date.now(), available };
  }
  return { status: 200, body: { payments: probe.available ? 'available' : 'paused' } };
}

export function notePaymentsOutage(available: boolean): void {
  probe = { checkedAt: Date.now(), available };
}
