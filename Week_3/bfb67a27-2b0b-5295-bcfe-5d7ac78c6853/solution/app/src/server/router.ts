import type { IncomingMessage, ServerResponse } from 'node:http';
import { pool } from './db.js';
import { ApiError, invalidPasscode, notFound } from './errors.js';
import {
  assertSameOrigin,
  readJsonBody,
  sendApiError,
  sendBytes,
  sendJson,
  sendRawJson,
} from './http.js';
import {
  clearSessionCookie,
  requireStaff,
  setSessionCookie,
  signIn,
  signOut,
} from './auth.js';
import { providerStatus } from './providerStatus.js';
import { getKit, getPrice, listKits } from './api/catalogue.js';
import { holdKit } from './api/holds.js';
import {
  listCertificates,
  readCertificateFile,
  reviewCertificate,
  uploadCertificate,
} from './api/certificates.js';
import { cancelBooking, confirmBooking } from './api/settle.js';
import {
  checkinUnit,
  checkoutBooking,
  closeBooking,
  getBooking,
  listBookings,
  prepBooking,
  swapUnit,
  uploadPhoto,
} from './api/counter.js';
import {
  getRateCards,
  getUtilisation,
  moveUnit,
  postRateCard,
  unitHistory,
} from './api/desk.js';

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  params: string[],
) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, pattern: string, handler: Handler): void {
  routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), handler });
}

function matchRoute(method: string, pathname: string): { route: Route; params: string[] } | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts.length) continue;
    const params: string[] = [];
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const expected = candidate.segments[index] as string;
      const actual = parts[index] as string;
      if (expected.startsWith(':')) {
        const decoded = decodeURIComponent(actual);
        if (decoded.includes('\0')) {
          matched = false;
          break;
        }
        params.push(decoded);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

function param(params: string[], index: number): string {
  const value = params[index];
  if (value === undefined) throw notFound();
  return value;
}

route('GET', '/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  sendJson(res, 200, { status: 'ok' });
});

route('GET', '/api/status', async (_req, res) => {
  sendJson(res, 200, await providerStatus());
});

route('POST', '/api/session', async (req, res) => {
  const body = (await readJsonBody(req)).parse();
  if (typeof body.passcode !== 'string' || body.passcode === '') throw invalidPasscode();
  const session = await signIn(body.passcode);
  if (session === null) throw invalidPasscode();
  setSessionCookie(res, session.id);
  sendJson(res, 200, { role: session.role });
});

route('GET', '/api/session', async (req, res) => {
  sendJson(res, 200, { role: await requireStaff(req) });
});

route('DELETE', '/api/session', async (req, res) => {
  const request = await readJsonBody(req, true);
  await requireStaff(req);
  request.parse();
  await signOut(req);
  clearSessionCookie(res);
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
});

route('GET', '/api/kits', async (_req, res, url) => {
  sendJson(res, 200, await listKits(url));
});

route('GET', '/api/kits/:kitId', async (_req, res, url, params) => {
  sendJson(res, 200, await getKit(url, param(params, 0)));
});

route('GET', '/api/price', async (_req, res, url) => {
  sendJson(res, 200, await getPrice(url));
});

route('POST', '/api/bookings', async (req, res) => {
  const stored = await holdKit(req);
  sendRawJson(res, stored.status, stored.body);
});

route('GET', '/api/bookings', async (req, res, url) => {
  sendJson(res, 200, await listBookings(req, url));
});

route('GET', '/api/bookings/:ref', async (req, res, _url, params) => {
  sendJson(res, 200, await getBooking(req, param(params, 0)));
});

route('POST', '/api/bookings/:ref/certificate', async (req, res, _url, params) => {
  sendJson(res, 201, await uploadCertificate(req, param(params, 0)));
});

route('POST', '/api/bookings/:ref/confirm', async (req, res, _url, params) => {
  const stored = await confirmBooking(req, param(params, 0));
  sendRawJson(res, stored.status, stored.body);
});

route('POST', '/api/bookings/:ref/cancel', async (req, res, _url, params) => {
  sendJson(res, 200, await cancelBooking(req, param(params, 0)));
});

route('POST', '/api/bookings/:ref/swap', async (req, res, _url, params) => {
  sendJson(res, 200, await swapUnit(req, param(params, 0)));
});

route('POST', '/api/bookings/:ref/prep', async (req, res, _url, params) => {
  sendJson(res, 200, await prepBooking(req, param(params, 0)));
});

route('POST', '/api/bookings/:ref/photos', async (req, res, _url, params) => {
  sendJson(res, 201, await uploadPhoto(req, param(params, 0)));
});

route('POST', '/api/bookings/:ref/checkout', async (req, res, _url, params) => {
  sendJson(res, 200, await checkoutBooking(req, param(params, 0)));
});

route('POST', '/api/bookings/:ref/checkin', async (req, res, _url, params) => {
  sendJson(res, 200, await checkinUnit(req, param(params, 0)));
});

route('POST', '/api/bookings/:ref/close', async (req, res, _url, params) => {
  const stored = await closeBooking(req, param(params, 0));
  sendRawJson(res, stored.status, stored.body);
});

route('GET', '/api/certificates', async (req, res, url) => {
  sendJson(res, 200, await listCertificates(req, url));
});

route('GET', '/api/certificates/:id/file', async (req, res, _url, params) => {
  const bytes = await readCertificateFile(req, param(params, 0));
  sendBytes(res, 200, 'application/pdf', bytes, 'no-store');
});

route('POST', '/api/certificates/:id/review', async (req, res, _url, params) => {
  sendJson(res, 200, await reviewCertificate(req, param(params, 0)));
});

route('POST', '/api/units/:serial/moves', async (req, res, _url, params) => {
  sendJson(res, 201, await moveUnit(req, param(params, 0)));
});

route('GET', '/api/units/:serial/history', async (req, res, _url, params) => {
  sendJson(res, 200, await unitHistory(req, param(params, 0)));
});

route('GET', '/api/utilisation', async (req, res) => {
  sendJson(res, 200, await getUtilisation(req));
});

route('GET', '/api/rate-cards', async (req, res) => {
  sendJson(res, 200, await getRateCards(req));
});

route('POST', '/api/rate-cards', async (req, res) => {
  sendJson(res, 201, await postRateCard(req));
});

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  try {
    assertSameOrigin(req);
    const matched = matchRoute(req.method ?? 'GET', url.pathname);
    if (matched === null) throw notFound();
    await matched.route.handler(req, res, url, matched.params);
  } catch (error) {
    if (error instanceof ApiError) {
      sendApiError(res, error);
      return;
    }
    process.stderr.write(`Unhandled API failure: ${String(error)}\n`);
    sendApiError(res, new ApiError(500, 'internal_error', 'Something went wrong'));
  }
}
