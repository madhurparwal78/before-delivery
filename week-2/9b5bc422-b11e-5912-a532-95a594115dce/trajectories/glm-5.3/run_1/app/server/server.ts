import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Db } from './db.js';
import { S3Client } from './s3.js';
import { GENERIC, sendError } from './errors.js';
import type { Change, DeviceInfo, } from '../shared/domain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? '';
const S3_BUCKET = process.env.S3_BUCKET ?? '';
const SHARE_LINK_SECONDS = Number(process.env.SHARE_LINK_SECONDS ?? 604800);
const ACCOUNT_STORAGE_BYTES = Number(process.env.ACCOUNT_STORAGE_BYTES ?? 50_000_000);
const BODY_LIMIT = 5_000_000;

const db = new Db(DATABASE_URL);
const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});

let dbUp = false;
let s3Up = false;

async function refreshHealth(): Promise<void> {
  dbUp = await db.check();
  if (dbUp) {
    try {
      await s3.put('health/oddment.txt', Buffer.from('ok'), 'text/plain');
      s3Up = true;
    } catch {
      s3Up = false;
    }
  } else {
    s3Up = false;
  }
}

function checkNow(): void {
  void refreshHealth();
}

// -- helpers -----------------------------------------------------------

interface Auth {
  userId: string;
  email: string;
  deviceId: string;
}


function isUuid(s: string | undefined | null): boolean {
  if (!s) return false;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return re.test(s);
}

function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 32).toString('hex');
  return `${s}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

function setSessionCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', `oddment_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`);
}

function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', 'oddment_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function json(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

async function auth(req: Request): Promise<Auth | null> {
  const token = parseCookies(req)['oddment_session'];
  if (!token || !isUuid(token)) return null;
  const result = await db.pool.query(
    `SELECT s.user_id, s.device_id, u.email, d.ended_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN devices d ON d.id = s.device_id
      WHERE s.id = $1`,
    [token]
  );
  if (result.rowCount === 0 || result.rows[0].ended_at) return null;
  return {
    userId: String(result.rows[0].user_id),
    email: String(result.rows[0].email),
    deviceId: String(result.rows[0].device_id),
  };
}

// Attach or create a device row for a signed-in person.
async function addDevice(userId: string, name: string): Promise<{ deviceId: string; sessionId: string }> {
  const count = await db.pool.query(`SELECT COUNT(*)::int AS n FROM devices WHERE user_id = $1`, [userId]);
  const n = (count.rows[0]?.n ?? 0) + 1;
  const deviceId = crypto.randomUUID();
  await db.pool.query(
    `INSERT INTO devices (id, user_id, name) VALUES ($1, $2, $3)`,
    [deviceId, userId, name ?? `Device ${n}`]
  );
  const sessionId = crypto.randomUUID();
  await db.pool.query(
    `INSERT INTO sessions (id, device_id, user_id) VALUES ($1, $2, $3)`,
    [sessionId, deviceId, userId]
  );
  return { deviceId, sessionId };
}

function deviceNameFor(n: number): string {
  return `Device ${n}`;
}

function sessionBody(userId: string, email: string, deviceId: string, deviceName: string) {
  return {
    user: { id: userId, email },
    device: { id: deviceId, name: deviceName },
  };
}

async function sessionInfo(userId: string, email: string, deviceId: string) {
  const d = await db.pool.query(`SELECT name FROM devices WHERE id = $1`, [deviceId]);
  return sessionBody(userId, email, deviceId, d.rows[0]?.name ?? '');
}

// JSONB reorders keys, so payloads are compared in a canonical form.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function textDiffers(change: Change, oldPayload: unknown): boolean {
  const oldP = (oldPayload ?? {}) as Record<string, unknown>;
  const newP = (change.payload ?? {}) as Record<string, unknown>;
  if (change.kind === 'document') return String(oldP.title ?? '') !== String(newP.title ?? '');
  if (change.kind === 'row') {
    const a = (oldP.values ?? {}) as Record<string, unknown>;
    const b = (newP.values ?? {}) as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (String(a[key] ?? '') !== String(b[key] ?? '')) return true;
    }
    return false;
  }
  return String(oldP.text ?? '') !== String(newP.text ?? '');
}

// -- sync engine -----------------------------------------------------------

async function applyChange(
  userId: string,
  change: Change,
  deviceId: string
): Promise<{ version: number; conflict: boolean; dropped: boolean }> {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT version, deleted, payload, document_id FROM sync_records WHERE account_id = $1 AND record_id = $2 FOR UPDATE`,
      [userId, change.recordId]
    );
    const had = (existing.rowCount ?? 0) > 0;
    const current = had ? existing.rows[0] : null;
    const oldVersion = had ? Number(current.version) : 0;
    const oldDeleted = had && Boolean(current.deleted);
    const oldPayload = had ? current.payload : null;
    const oldDocumentId = had ? (current.document_id as string | null) : null;

    // Delete forever beats offline edits: a change for a document that is
    // gone is dropped, and the device is told so it can show the notice.
    if (change.documentId) {
      const doc = await client.query(
        `SELECT deleted, payload FROM sync_records WHERE account_id = $1 AND record_id = $2 AND kind = 'document'`,
        [userId, change.documentId]
      );
      if ((doc.rowCount ?? 0) > 0) {
        const p = doc.rows[0].payload as { gone?: boolean } | null;
        if (doc.rows[0].deleted && p?.gone) {
          await client.query('COMMIT');
          return { version: oldVersion, conflict: false, dropped: true };
        }
      }
    }

    const payloadJson = canonicalJson(change.payload ?? null);

    // Idempotent replay: same record, same payload, same deleted flag.
    if (had && canonicalJson(oldPayload ?? null) === payloadJson && oldDeleted === Boolean(change.deleted)) {
      await client.query('COMMIT');
      return { version: oldVersion, conflict: false, dropped: false };
    }

    // An upload of a record the account already holds never changes what the
    // account has: unedited records are created only when missing.
    if (change.createOnly && had) {
      await client.query('COMMIT');
      return { version: oldVersion, conflict: false, dropped: false };
    }

    const conflictRow = await client.query(
      `SELECT 1 FROM sync_conflicts WHERE account_id = $1 AND record_id = $2`,
      [userId, change.recordId]
    );
    const hadConflict = (conflictRow.rowCount ?? 0) > 0;

    const hasBase = typeof change.baseVersion === 'number' && change.baseVersion !== null;
    // Both kept appears only when the text a person reads has really changed on
    // both sides; order, stars, folders and tags follow last-write-wins.
    let conflict = false;
    if (hadConflict) {
      // A pick for an existing Both kept: apply and clear.
      conflict = false;
    } else if (hasBase && had && !oldDeleted && change.baseVersion !== oldVersion && textDiffers(change, oldPayload)) {
      conflict = true;
    }

    const version = (had ? oldVersion : 0) + 1;

    await client.query(
      `INSERT INTO sync_records (account_id, record_id, kind, document_id, version, deleted, payload, base_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account_id, record_id)
       DO UPDATE SET version = $5, deleted = $6, payload = $7, kind = $3, document_id = $4, base_version = $8`,
      [userId, change.recordId, change.kind, change.documentId ?? oldDocumentId, version, change.deleted ?? false, payloadJson, change.baseVersion ?? null]
    );

    await client.query(
      `INSERT INTO sync_log (account_id, record_id, kind, version, deleted, payload, device_id, conflict)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, change.recordId, change.kind, version, change.deleted ?? false, payloadJson, deviceId, conflict]
    );

    if (conflict) {
      await client.query(
        `INSERT INTO sync_conflicts (account_id, record_id, version, a_payload, b_payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, record_id) DO UPDATE SET version = $3, a_payload = $4, b_payload = $5`,
        [userId, change.recordId, version, JSON.stringify(oldPayload ?? null), payloadJson]
      );
    } else {
      await client.query(`DELETE FROM sync_conflicts WHERE account_id = $1 AND record_id = $2`, [userId, change.recordId]);
    }

    // Delete forever cascades: its records leave the account, the objects
    // leave storage, and other devices drop them at their next pull.
    if (change.kind === 'document' && change.deleted) {
      const gone = change.payload as { gone?: boolean } | null;
      if (gone?.gone) {
        const related = await client.query(
          `SELECT record_id, kind FROM sync_records WHERE account_id = $1 AND document_id = $2 AND record_id <> $3`,
          [userId, change.documentId ?? change.recordId, change.recordId]
        );
        for (const r of related.rows as { record_id: string; kind: string }[]) {
          if (r.kind === 'attachment') {
            await s3.delete(attachmentKey(userId, r.record_id));
          }
          const v = await client.query(
            `SELECT version FROM sync_records WHERE account_id = $1 AND record_id = $2`,
            [userId, r.record_id]
          );
          const nextV = ((v.rowCount ?? 0) > 0 ? Number(v.rows[0].version) : 0) + 1;
          await client.query(
            `UPDATE sync_records SET deleted = TRUE, payload = NULL, version = $3 WHERE account_id = $1 AND record_id = $2`,
            [userId, r.record_id, nextV]
          );
          await client.query(
            `INSERT INTO sync_log (account_id, record_id, kind, version, deleted, payload, device_id, conflict)
             VALUES ($1, $2, $3, $4, TRUE, NULL, $5, FALSE)`,
            [userId, r.record_id, r.kind, nextV, deviceId]
          );
        }
        await client.query(`UPDATE share_links SET revoked = TRUE WHERE user_id = $1 AND document_id = $2`, [userId, change.recordId]);
      }
    }

    await client.query('COMMIT');
    return { version, conflict, dropped: false };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// -- the app -----------------------------------------------------------

const app = express();
app.disable('x-powered-by');

// Same-origin only, and the published body limit.
app.use(express.json({ limit: BODY_LIMIT, type: 'application/json' }));
app.use(express.raw({ limit: BODY_LIMIT + 1024, type: () => true }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (!origin || new URL(origin).origin !== `http://${req.headers.host}` && new URL(origin).origin !== `https://${req.headers.host}`) {
    if (origin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.status(403).json(GENERIC.crossOrigin);
      return;
    }
  }
  next();
});

// Size guard: express enforces it, but answer the published body for oversized requests.
app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    res.status(413).json(GENERIC.tooLarge);
    return;
  }
  next(err);
});

// -- public endpoints ----------------------------------------------------

app.get('/api/health', (_req, res) => {
  checkNow();
  res.json({ status: dbUp ? (s3Up ? 'ok' : 'unavailable') : 'unavailable' });
});

app.get('/api/status', async (_req, res) => {
  await refreshHealth();
  res.json({ sync: dbUp ? 'ok' : 'unavailable', storage: s3Up ? 'ok' : 'unavailable' });
});

app.get('/api/session', async (req, res) => {
  const token = parseCookies(req)['oddment_session'];
  if (!token || !isUuid(token)) {
    res.json({});
    return;
  }
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.json({});
    return;
  }
  res.json(await sessionInfo(a.userId, a.email, a.deviceId));
});

app.post('/api/accounts', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const body = json(req);
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(res, 422, 'email', 'Enter a valid email address.');
    return;
  }
  if (password.length < 8) {
    sendError(res, 422, 'password', 'Use at least 8 characters.');
    return;
  }
  try {
    const id = crypto.randomUUID();
    await db.pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
      [id, email.toLowerCase(), hashPassword(password)]
    );
    const { deviceId, sessionId } = await addDevice(id, 'Device 1');
    setSessionCookie(res, sessionId);
    res.status(201).json(sessionBody(id, email.toLowerCase(), deviceId, 'Device 1'));
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === '23505') {
      sendError(res, 409, 'email', 'That email already has an account.');
      return;
    }
    throw e;
  }
});

app.post('/api/sessions', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const body = json(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const result = await db.pool.query(`SELECT id, email, password_hash FROM users WHERE email = $1`, [email]);
  if (result.rowCount === 0 || !verifyPassword(password, String(result.rows[0].password_hash))) {
    res.status(401).json({ errors: { form: 'That email and password do not match.' } });
    return;
  }
  const user = result.rows[0];
  const n = await db.pool.query(`SELECT COUNT(*)::int AS n FROM devices WHERE user_id = $1`, [user.id]);
  const name = deviceNameFor((n.rows[0]?.n ?? 0) + 1);
  const { deviceId, sessionId } = await addDevice(user.id, name);
  setSessionCookie(res, sessionId);
  res.json(sessionBody(user.id, user.email, deviceId, name));
});

app.delete('/api/session', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  const token = parseCookies(req)['oddment_session'];
  const result = await db.pool.query(
    `DELETE FROM sessions WHERE id = $1 RETURNING device_id`,
    [token]
  );
  if ((result.rowCount ?? 0) > 0) {
    await db.pool.query(`DELETE FROM devices WHERE id = $1`, [result.rows[0].device_id]);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

app.get('/api/devices', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  const result = await db.pool.query(
    `SELECT id, name, last_seen_at FROM devices WHERE user_id = $1 AND ended_at IS NULL ORDER BY created_at`,
    [a.userId]
  );
  const devices: DeviceInfo[] = result.rows.map((r: { id: string; name: string; last_seen_at: Date }) => ({
    id: r.id,
    name: r.name,
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    current: r.id === a.deviceId,
  }));
  res.json({ devices });
});

app.delete('/api/devices/:deviceId', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  if (!isUuid(req.params.deviceId)) {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  if (req.params.deviceId === a.deviceId) {
    res.status(409).json({ errors: { form: 'Use Sign out on this device.' } });
    return;
  }
  const result = await db.pool.query(
    `UPDATE devices SET ended_at = now() WHERE id = $1 AND user_id = $2 AND ended_at IS NULL RETURNING id`,
    [req.params.deviceId, a.userId]
  );
  if (result.rowCount === 0) {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  await db.pool.query(`DELETE FROM sessions WHERE device_id = $1`, [req.params.deviceId]);
  res.status(204).end();
});

// -- attachments ---------------------------------------------------------

const FILE_SIZE_LIMIT = 5_000_000;
const attachmentKey = (userId: string, attachmentId: string) => `attachments/${userId}/${attachmentId}`;

app.put('/api/attachments/:attachmentId', async (req, res) => {
  if (!dbUp || !s3Up) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  const id = req.params.attachmentId;
  if (!isUuid(id)) {
    sendError(res, 422, 'id', 'Use a UUID.');
    return;
  }
  const documentId = req.headers['x-document-id'] as string | undefined;
  if (!documentId) {
    sendError(res, 422, 'documentId', 'Enter a document id.');
    return;
  }
  const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'file'));
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (body.length > FILE_SIZE_LIMIT) {
    sendError(res, 413, 'file', 'That file is larger than 5,000,000 bytes.');
    return;
  }
  const contentType = String(req.headers['content-type'] ?? 'application/octet-stream');

  // Replay check: an attachment id already used with different bytes is refused.
  const existing = await db.pool.query(
    `SELECT payload FROM sync_records WHERE account_id = $1 AND record_id = $2 AND kind = 'attachment'`,
    [a.userId, id]
  );
  if ((existing.rowCount ?? 0) > 0) {
    const stored = await s3.get(attachmentKey(a.userId, id));
    if (stored && stored.body.equals(body)) {
      res.status(200).json({ id, name: fileName, size: body.length, contentType, state: 'stored' });
      return;
    }
    res.status(409).json({ errors: { form: 'That attachment id is already used.' } });
    return;
  }

  const usage = await db.pool.query(`SELECT storage_bytes FROM users WHERE id = $1`, [a.userId]);
  const used = Number(usage.rows[0]?.storage_bytes ?? 0);
  if (used + body.length > ACCOUNT_STORAGE_BYTES) {
    res.status(507).json({ errors: { file: 'Your account storage is full.' } });
    return;
  }

  // The file may reach the server before its document.
  const ok = await s3.put(attachmentKey(a.userId, id), body, contentType);
  if (!ok) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  await db.pool.query(`UPDATE users SET storage_bytes = storage_bytes + $2 WHERE id = $1`, [a.userId, body.length]);
  const payload = { id, name: fileName, size: body.length, contentType, state: 'stored' };
  await applyChange(
    a.userId,
    { id: `server-${id}`, kind: 'attachment', recordId: id, documentId, payload },
    a.deviceId
  );
  res.status(201).json(payload);
});

app.get('/api/attachments/:attachmentId', async (req, res) => {
  if (!dbUp || !s3Up) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  if (!isUuid(req.params.attachmentId)) {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  const result = await db.pool.query(
    `SELECT payload FROM sync_records WHERE account_id = $1 AND record_id = $2 AND kind = 'attachment'`,
    [a.userId, req.params.attachmentId]
  );
  if (result.rowCount === 0) {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  const payload = result.rows[0].payload as { name?: string; contentType?: string } | null;
  const object = await s3.get(attachmentKey(a.userId, req.params.attachmentId));
  if (!object) {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  const name = (payload?.name ?? 'file').replace(/"/g, '');
  res.setHeader('Content-Type', payload?.contentType ?? object.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(object.body);
});

app.delete('/api/attachments/:attachmentId', async (req, res) => {
  if (!dbUp || !s3Up) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  if (!isUuid(req.params.attachmentId)) {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  const result = await db.pool.query(
    `SELECT payload FROM sync_records WHERE account_id = $1 AND record_id = $2 AND kind = 'attachment'`,
    [a.userId, req.params.attachmentId]
  );
  if (result.rowCount === 0) {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  const payload = result.rows[0].payload as { size?: number } | null;
  await s3.delete(attachmentKey(a.userId, req.params.attachmentId));
  if (payload?.size) {
    await db.pool.query(`UPDATE users SET storage_bytes = GREATEST(0, storage_bytes - $2) WHERE id = $1`, [a.userId, payload.size]);
  }
  res.status(204).end();
});

// -- share links -----------------------------------------------------------

async function shareDocState(userId: string, documentId: string): Promise<'none' | 'trashed' | 'ok'> {
  const r = await db.pool.query(
    `SELECT payload FROM sync_records WHERE account_id = $1 AND record_id = $2 AND kind = 'document'`,
    [userId, documentId]
  );
  if (r.rowCount === 0) return 'none';
  const p = r.rows[0].payload as { trashed?: boolean } | null;
  if (p?.trashed) return 'trashed';
  return 'ok';
}

app.get('/api/documents/:documentId/share', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  const docState = await shareDocState(a.userId, req.params.documentId);
  if (docState === 'none') {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  const r = await db.pool.query(
    `SELECT token, expires_at FROM share_links WHERE user_id = $1 AND document_id = $2 AND revoked = FALSE AND expires_at > now()`,
    [a.userId, req.params.documentId]
  );
  if (r.rowCount === 0) {
    res.json({ share: null });
    return;
  }
  const row = r.rows[0];
  const origin = `http://${req.headers.host}`;
  res.json({ share: { token: row.token, url: `${origin}/s/${row.token}`, expiresAt: new Date(row.expires_at).toISOString() } });
});

app.post('/api/documents/:documentId/share', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  const docState = await shareDocState(a.userId, req.params.documentId);
  if (docState === 'none') {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  // An active link dies at once.
  await db.pool.query(
    `UPDATE share_links SET revoked = TRUE WHERE user_id = $1 AND document_id = $2 AND revoked = FALSE`,
    [a.userId, req.params.documentId]
  );
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SHARE_LINK_SECONDS * 1000);
  await db.pool.query(
    `INSERT INTO share_links (token, user_id, document_id, expires_at) VALUES ($1, $2, $3, $4)`,
    [token, a.userId, req.params.documentId, expiresAt]
  );
  const origin = `http://${req.headers.host}`;
  res.status(201).json({ token, url: `${origin}/s/${token}`, expiresAt: expiresAt.toISOString() });
});

app.delete('/api/documents/:documentId/share', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  const docState = await shareDocState(a.userId, req.params.documentId);
  if (docState === 'none') {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  const r = await db.pool.query(
    `UPDATE share_links SET revoked = TRUE WHERE user_id = $1 AND document_id = $2 AND revoked = FALSE RETURNING token`,
    [a.userId, req.params.documentId]
  );
  if (r.rowCount === 0) {
    res.status(404).json(GENERIC.notFound);
    return;
  }
  res.status(204).end();
});

app.get('/api/shared/:token', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const link = await db.pool.query(
    `SELECT user_id, document_id FROM share_links WHERE token = $1 AND revoked = FALSE AND expires_at > now()`,
    [req.params.token]
  );
  if (link.rowCount === 0) {
    res.status(404).json({ errors: { form: 'This link no longer works.' } });
    return;
  }
  const userId = String(link.rows[0].user_id);
  const documentId = String(link.rows[0].document_id);
  const docState = await shareDocState(userId, documentId);
  if (docState !== 'ok') {
    res.status(404).json({ errors: { form: 'This link no longer works.' } });
    return;
  }
  const docRow = await db.pool.query(
    `SELECT payload FROM sync_records WHERE account_id = $1 AND record_id = $2 AND kind = 'document'`,
    [userId, documentId]
  );
  const meta = docRow.rows[0].payload as { title?: string } | null;
  const blockRows = await db.pool.query(
    `SELECT payload FROM sync_records WHERE account_id = $1 AND document_id = $2 AND kind = 'block' AND deleted = FALSE ORDER BY version`,
    [userId, documentId]
  );
  const blocks = blockRows.rows.map((r: { payload: unknown }) => r.payload);
  const attachments = await db.pool.query(
    `SELECT payload FROM sync_records WHERE account_id = $1 AND document_id = $2 AND kind = 'attachment' AND deleted = FALSE`,
    [userId, documentId]
  );
  const list = attachments.rows.map((r: { payload: unknown }) => r.payload);
  res.json({
    title: meta?.title ?? '',
    blocks,
    attachments: list,
  });
});

app.get('/api/shared/:token/attachments/:attachmentId', async (req, res) => {
  if (!dbUp || !s3Up) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const link = await db.pool.query(
    `SELECT user_id, document_id FROM share_links WHERE token = $1 AND revoked = FALSE AND expires_at > now()`,
    [req.params.token]
  );
  if (link.rowCount === 0) {
    res.status(404).json({ errors: { form: 'This link no longer works.' } });
    return;
  }
  const userId = String(link.rows[0].user_id);
  const documentId = String(link.rows[0].document_id);
  const r = await db.pool.query(
    `SELECT payload FROM sync_records WHERE account_id = $1 AND record_id = $2 AND document_id = $3 AND kind = 'attachment'`,
    [userId, req.params.attachmentId, documentId]
  );
  if (r.rowCount === 0) {
    res.status(404).json({ errors: { form: 'This link no longer works.' } });
    return;
  }
  const payload = r.rows[0].payload as { name?: string; contentType?: string } | null;
  const object = await s3.get(attachmentKey(userId, req.params.attachmentId));
  if (!object) {
    res.status(404).json({ errors: { form: 'This link no longer works.' } });
    return;
  }
  const name = (payload?.name ?? 'file').replace(/"/g, '');
  res.setHeader('Content-Type', payload?.contentType ?? object.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(object.body);
});

// Read-only shared surface.
app.all('/api/shared/:token*', (_req, res) => {
  res.status(405).json(GENERIC.readOnly);
});

// -- sync -------------------------------------------------------------------

interface PushResult {
  id: string;
  recordId: string;
  version: number;
  conflict: boolean;
  deleted: boolean;
  dropped: boolean;
}


app.post('/api/sync/push', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  const body = json(req);
  const changes = Array.isArray(body.changes) ? (body.changes as Change[]) : [];
  const results: PushResult[] = [];
  for (const change of changes) {
    if (!change || typeof change !== 'object' || !change.recordId || !change.kind) continue;
    const r = await applyChange(a.userId, change, a.deviceId);
    results.push({ id: change.id, recordId: change.recordId, version: r.version, conflict: r.conflict, deleted: Boolean(change.deleted), dropped: r.dropped });
  }
  const cursor = await db.pool.query(`SELECT COALESCE(MAX(seq), 0)::bigint AS v FROM sync_log WHERE account_id = $1`, [a.userId]);
  res.json({ results, cursor: Number(cursor.rows[0].v) });
});

app.get('/api/sync/pull', async (req, res) => {
  if (!dbUp) {
    res.status(503).json(GENERIC.unavailable);
    return;
  }
  const a = await auth(req);
  if (!a) {
    res.status(401).json(GENERIC.unauthorised);
    return;
  }
  const since = Number(req.query.since ?? 0);
  const rows = await db.pool.query(
    `SELECT seq, record_id, kind, version, deleted, payload, device_id, conflict FROM sync_log
      WHERE account_id = $1 AND seq > $2 ORDER BY seq LIMIT 5000`,
    [a.userId, since]
  );
  const conflictRows = await db.pool.query(
    `SELECT record_id, a_payload, b_payload FROM sync_conflicts WHERE account_id = $1`,
    [a.userId]
  );
  const conflictMap = new Map<string, { a: unknown; b: unknown }>();
  for (const r of conflictRows.rows as { record_id: string; a_payload: string | null; b_payload: string | null }[]) {
    conflictMap.set(r.record_id, {
      a: r.a_payload ? JSON.parse(r.a_payload) : null,
      b: r.b_payload ? JSON.parse(r.b_payload) : null,
    });
  }
  const changes = rows.rows.map((r: { seq: string | number; record_id: string; kind: string; version: string | number; deleted: boolean; payload: unknown; device_id: string; conflict: boolean }) => {
    const c = conflictMap.get(r.record_id);
    return {
      id: String(r.seq),
      kind: r.kind,
      recordId: r.record_id,
      version: Number(r.version),
      conflict: r.conflict,
      conflictValues: r.conflict && c ? [c.a, c.b] : null,
      payload: r.payload,
      deleted: r.deleted,
      deviceId: r.device_id,
    };
  });
  let cursor = since;
  const rowCount = rows.rowCount ?? 0;
  if (rowCount > 0) {
    const last = rows.rows[rowCount - 1] as { seq: string | number };
    cursor = Number(last.seq);
  }
  res.json({ changes, cursor });
});

// -- boundary and static serving --------------------------------------------

app.use('/api', (_req, res) => {
  res.status(404).json(GENERIC.notFound);
});

const FORBIDDEN = new Set(['package.json', 'package-lock.json', 'run.json', 'vite.config.ts', 'tsconfig.json']);

const CLIENT_DIR = path.resolve(__dirname, '../client');

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = path.basename(pathname);
  if (FORBIDDEN.has(base) || base.startsWith('.') || base.startsWith('env')) {
    next();
    return;
  }
  const filePath = path.normalize(path.join(CLIENT_DIR, pathname));
  if (filePath.startsWith(CLIENT_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath);
    return;
  }
  // Any other path serves the app.
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ errors: { form: 'The server is unavailable.' } });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Oddment listening on port ${PORT}`);
});

void refreshHealth();
// Keep retrying dependencies in the background.
const healthTimer = setInterval(() => {
  void refreshHealth();
}, 5000);
healthTimer.unref();

process.on('SIGTERM', () => server.close(() => process.exit(0)));


