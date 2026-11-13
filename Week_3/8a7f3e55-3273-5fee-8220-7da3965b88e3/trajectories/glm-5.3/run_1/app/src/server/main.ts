// The server loop: origin checks, body limits, session auth, idempotency wrapper, routing,
// error precedence, static serving and the background workers.
import http from 'node:http';
import { loadConfig, type Config } from './config.js';
import { Db, waitForDatabase } from './db.js';
import { ApiError } from './errors.js';
import {
  readBody, originAllowed, isJsonRequest, isMultipartRequest, parseCookies, serveStatic,
  sessionUser, sessionTokenOf,
  type RouteRequest, type HandlerResult, type AppContext, errorBody,
} from './http.js';
import { matchRoute } from './routes.js';
import { claimKey, finishKey, releaseKey, validateKey, gcKeys } from './idempotency.js';
import { KillBillClient } from './killbill.js';
import { PrepStorage } from './storage.js';
import { SmtpMailer } from './mailer.js';
import { Readable } from 'node:stream';

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 10_100_000;

export interface Runtime {
  db: Db;
  config: Config;
  killbill: KillBillClient;
  storage: PrepStorage;
  mailer: SmtpMailer;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Db(config);
  await waitForDatabase(db, config);
  const killbill = new KillBillClient(config.killbill);
  const storage = new PrepStorage(config.s3);
  const mailer = new SmtpMailer({ ...config.smtp, from: config.mailFrom });
  const app: AppContext = { db, config };
  const runtime: Runtime = { db, config, killbill, storage, mailer };

  startWorkers(runtime);

  const server = http.createServer((req, res) => {
    handle(req, res, app, runtime).catch((err) => {
      console.error('Unhandled request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'internal', message: 'The request could not be completed.' }));
    });
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Relayline serving on port ${config.port}`);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, app: AppContext, runtime: Runtime): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  const finish = (status: number, body: Buffer | string, headers: Record<string, string | string[]> = {}, cookies: string[] = []) => {
    const allHeaders: Record<string, string | string[]> = { ...headers };
    if (typeof body === 'string' && !allHeaders['Content-Type']) {
      allHeaders['Content-Type'] = 'application/json; charset=utf-8';
    }
    if (cookies.length > 0) allHeaders['Set-Cookie'] = cookies;
    res.writeHead(status, allHeaders);
    res.end(body);
  };

  const fail = (err: ApiError, cookies: string[] = []) => {
    finish(err.status(), JSON.stringify(errorBody(err)), {}, cookies);
  };

  // 1. Cross-origin writes are rejected before anything else happens.
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !originAllowed(req, app.config.port)) {
    return fail(new ApiError('cross_origin', 'This request comes from another origin.'));
  }

  if (!pathname.startsWith('/api/')) {
    const result = await serveStatic(pathname);
    const body = typeof result.body === 'string' ? result.body : (result.body as Buffer);
    return finish(result.status, body, result.headers ?? {});
  }

  const match = matchRoute(method, pathname);
  if (match === null) {
    return fail(new ApiError('not_found', 'Nothing is served at this address.'));
  }

  // 2. Request body limits by request kind.
  const isUpload = isMultipartRequest(req);
  const limit = isUpload ? MULTIPART_LIMIT : JSON_LIMIT;
  let raw: Buffer | undefined = undefined;
  let oversize = false;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const body = await readBody(req, limit);
    if (body === null) oversize = true;
    else raw = body;
  }
  if (oversize) {
    return fail(new ApiError('payload_too_large', 'The request body is too large.'));
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = sessionTokenOf(cookies);
  const session = await sessionUser(app.db, token);
  const route = match.route;
  const routeRequest: RouteRequest = {
    req,
    method,
    pathname,
    query: url.searchParams,
    body: { json: raw && raw.length > 0 && isJsonRequest(req) ? safeJson(raw) : undefined, raw },
    cookies,
    user: session?.user ?? null,
    sessionId: session?.sessionId ?? null,
    rawBody: raw ?? null,
    params: match.params,
  };

  // 3. Unauthenticated.
  if (route.requiresAuth && session === null) {
    return fail(new ApiError('unauthenticated', 'Sign in to continue.'));
  }

  // 4. Idempotency for POST endpoints except session and uploads.
  const idemHeader = req.headers['idempotency-key'];
  if (method === 'POST' && session !== null && pathname !== '/api/session' && !isUpload && typeof idemHeader === 'string') {
    const keyInvalid = validateKey(idemHeader);
    if (keyInvalid !== null) return fail(keyInvalid);
    const bodyBuf = raw ?? Buffer.alloc(0);
    const claim = await claimKey(app.db, session.user.id, idemHeader, method, pathname, bodyBuf);
    if (claim.kind === 'in_progress') {
      return fail(new ApiError('idempotency_in_progress', 'That request is still being processed. Wait a moment, then check.'));
    }
    if (claim.kind === 'reused') {
      return fail(new ApiError('idempotency_key_reused', 'This Idempotency-Key was used for a different request.'));
    }
    if (claim.kind === 'replay') {
      return finish(claim.status!, claim.body ?? '', {});
    }
    try {
      const result = await route.handler(routeRequest, app, match.params);
      const bodyStr = result.body instanceof Readable ? '' : JSON.stringify(result.body ?? null);
      await finishKey(app.db, session.user.id, idemHeader, result.status, bodyStr);
      return finish(result.status, bodyStr, result.headers ?? {});
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr && apiErr.status() === 503) {
        await releaseKey(app.db, session.user.id, idemHeader);
      } else {
        await finishKey(app.db, session.user.id, idemHeader, apiErr ? apiErr.status() : 500, JSON.stringify(apiErr ? errorBody(apiErr) : { error: 'internal', message: 'The request could not be completed.' }));
      }
      if (apiErr) return fail(apiErr);
      throw err;
    }
  }

  try {
    const result = await route.handler(routeRequest, app, match.params);
    if (result.body instanceof Readable || result.body instanceof Uint8Array) {
      streamOut(res, result, []);
      return;
    }
    return finish(result.status, JSON.stringify(result.body ?? null), result.headers ?? {});
  } catch (err) {
    if (err instanceof ApiError) return fail(err);
    throw err;
  }
}

function safeJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return undefined;
  }
}

function streamOut(res: http.ServerResponse, result: HandlerResult, cookies: string[]): void {
  const stream = result.body as Readable;
  const headers: Record<string, string | string[]> = { ...(result.headers ?? {}) };
  if (cookies.length > 0) headers['Set-Cookie'] = cookies;
  res.writeHead(result.status, headers);
  stream.pipe(res);
  // Release the storage connection at once when the client leaves.
  res.on('close', () => {
    stream.destroy();
  });
}

// ---------- background workers ----------

/** Emails wait in the queue and go out within 30 seconds of the mail server returning;
 * pending invoice lines post to Kill Bill and sync by reading their charges back. */
function startWorkers(runtime: Runtime): void {
  let mailUp = true;
  setInterval(async () => {
    try {
      await sendQueuedEmails(runtime, () => mailUp);
      mailUp = true;
    } catch {
      mailUp = false;
    }
  }, 5000).unref();

  setInterval(async () => {
    try {
      await syncPendingLines(runtime);
    } catch {
      // Kill Bill down: retried on the next tick without a restart.
    }
  }, 5000).unref();

  setInterval(async () => {
    try {
      await gcKeys(runtime.db);
    } catch {
      // Keys are GCed on the next tick.
    }
  }, 300_000).unref();
}

async function sendQueuedEmails(runtime: Runtime, _isUp: () => boolean): Promise<void> {
  const res = await runtime.db.query<{ id: string; to_email: string; subject: string; body: string }>(
    `SELECT id, to_email, subject, body FROM email_queue
     WHERE sent_at IS NULL
     ORDER BY id
     LIMIT 50`,
  );
  for (const row of res.rows) {
    const sent = await runtime.mailer.send({ to: row.to_email, subject: row.subject, body: row.body });
    if (sent) {
      await runtime.db.query('UPDATE email_queue SET sent_at = now() WHERE id = $1', [row.id]);
    }
  }
}

/** Post pending lines to Kill Bill and adopt any charge an unclear failure already made.
 * A line becomes synced only after its charge is read back and the item id stored. */
async function syncPendingLines(runtime: Runtime): Promise<void> {
  const res = await runtime.db.query<{
    line_ref: string; booking_ref: string; org_id: string; kind: string; amount_cents: number;
  }>(
    `SELECT line_ref, booking_ref, org_id, kind, amount_cents FROM invoice_lines
     WHERE sync_status = 'pending_sync' ORDER BY seq LIMIT 20`,
  );
  if (res.rowCount === 0) return;
  for (const line of res.rows) {
    const orgRes = await runtime.db.query<{ name: string }>('SELECT name FROM organisations WHERE id = $1', [line.org_id]);
    let accountId: string;
    try {
      accountId = await ensureAccountCached(runtime, line.org_id, orgRes.rows[0].name);
    } catch {
      continue;
    }
    const description = `${line.line_ref} ${line.booking_ref} ${line.kind === 'completed' ? 'completed' : 'late cancellation'}`;
    let itemId: string | null = null;
    try {
      const charges = await runtime.killbill.listCharges(accountId);
      // After an unclear failure, adopt a charge that was already posted for this line.
      const existing = charges.find((c) => (c.description ?? '').startsWith(`${line.line_ref} `));
      if (existing) {
        itemId = existing.invoiceItemId;
      } else {
        const posted = await runtime.killbill.postCharge(accountId, line.amount_cents, description);
        itemId = posted.invoiceItemId;
      }
    } catch {
      continue;
    }
    if (itemId === null) continue;
    // Read the charge back before marking synced.
    let total: number | null = null;
    try {
      const charges = await runtime.killbill.listCharges(accountId);
      const charge = charges.find((c) => c.invoiceItemId === itemId);
      if (charge) total = Math.round(charge.amount * 100);
    } catch {
      continue;
    }
    if (total === null) continue;
    await runtime.db.query(
      `UPDATE invoice_lines SET sync_status = 'synced', kb_item_id = $2, billing_amount_cents = $3 WHERE line_ref = $1`,
      [line.line_ref, itemId, total],
    );
  }
}

async function ensureAccountCached(runtime: Runtime, orgId: string, orgName: string): Promise<string> {
  const cached = await runtime.db.query<{ kb_account_id: string }>('SELECT kb_account_id FROM kb_accounts WHERE org_id = $1', [orgId]);
  if (cached.rowCount !== 0 && cached.rows[0].kb_account_id) return cached.rows[0].kb_account_id;
  const accountId = await runtime.killbill.ensureAccount(orgId, orgName);
  await runtime.db.query('INSERT INTO kb_accounts (org_id, kb_account_id) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET kb_account_id = EXCLUDED.kb_account_id', [orgId, accountId]);
  return accountId;
}

if (process.argv[1] && process.argv[1].endsWith('main.js')) {
  main().catch((err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}
