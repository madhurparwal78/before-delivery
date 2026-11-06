import { sendJson, type Req, type Router } from './http.js';
import { one, rows, query, tx } from './db.js';
import {
  forbidden, notFound, stepUpRequired, validationFailed, workspaceSuspended, fail,
} from './errors.js';
import { requireSession, membership } from './auth.js';
import { bucketByName } from './objects.js';
import { audit } from './audit.js';

function jsonBody(req: Req): Record<string, unknown> {
  if (!req.rawBody || req.rawBody.length === 0) return {};
  try { return JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}
function iso(d: Date): string { return d.toISOString(); }

export interface Auth {
  user: { id: string; email: string; name: string; operator: boolean };
  sessionId: string;
  confirmedUntil: Date | null;
}

/** Resolves a workspace path: the caller must be a member. */
export async function wsCtx(slug: string, auth: Auth): Promise<{ ws: { slug: string; name: string; status: string; plan: string }; role: string }> {
  if (auth.user.operator) throw notFound();
  const ws = await one<{ slug: string; name: string; status: string; plan: string }>(
    `SELECT slug, name, status, plan FROM workspaces WHERE slug = $1`, [slug]
  );
  if (!ws) throw notFound();
  const m = await membership(slug, auth.user.id);
  if (!m) throw notFound();
  return { ws, role: m.role };
}

export function requireWrite(role: string): void {
  if (role !== 'developer' && role !== 'owner') throw forbidden();
}

/** The step-up check: after the role check, before suspension. */
export async function requireStepUp(auth: Auth, ws: string): Promise<void> {
  const ts = await one<{ enabled: boolean }>(`SELECT enabled FROM two_step WHERE user_id = $1`, [auth.user.id]);
  if (!ts?.enabled) return;
  const s = await one<{ confirmed_until: Date | null }>(`SELECT confirmed_until FROM sessions WHERE id = $1`, [auth.sessionId]);
  if (!s?.confirmed_until || s.confirmed_until.getTime() <= Date.now()) throw stepUpRequired();
  void ws;
}

async function auditDenied(role: string, ws: string, auth: Auth, method: string, path: string): Promise<void> {
  // Called by callers that catch a forbidden for role; the audit entry is written here.
  void role;
  await audit(ws, auth.user.email, 'permission.denied', path, `${method} ${path}`);
}

export function registerWorkspaceRoutes(json: Router): void {
  json.get('/api/w/{ws}/buckets', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const list = await rows<{ name: string; placement: string[]; created_at: Date; object_count: string; stored_bytes: string }>(
      `SELECT name, placement, created_at, object_count::text AS object_count, stored_bytes::text AS stored_bytes
       FROM buckets WHERE workspace_slug = $1 ORDER BY name`, [ws.slug]
    );
    sendJson(res, 200, {
      buckets: list.map(b => ({
        name: b.name, placement: b.placement, created_at: iso(b.created_at),
        object_count: Number(b.object_count), stored_bytes: Number(b.stored_bytes),
      })),
    });
  });

  json.post('/api/w/{ws}/buckets', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'developer' && role !== 'owner') {
      await auditDenied(role, ws.slug, auth, req.method, req.rawPath);
      throw forbidden();
    }
    if (ws.status === 'suspended') throw workspaceSuspended();
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'name' && k !== 'placement') errors[k] = "This field can't be set.";
    if (!('name' in body)) errors.name = 'This field is required.';
    if (!('placement' in body)) errors.placement = 'This field is required.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const name = String(body.name ?? '');
    const placementRaw = body.placement;
    if (!isValidBucketName(name)) {
      throw validationFailed({ name: 'Bucket names are 3 to 63 lowercase letters, digits or hyphens, starting and ending with a letter or digit.' });
    }
    if (!Array.isArray(placementRaw)) {
      throw validationFailed({ placement: 'Choose 1 to 4 different regions; the first is the origin.' });
    }
    const placement = placementRaw.map(String);
    const known = await rows<{ id: string }>(`SELECT id FROM regions`);
    const knownIds = new Set(known.map(r => r.id));
    const distinct = new Set(placement);
    if (placement.length < 1 || placement.length > 4 || distinct.size !== placement.length || placement.some(p => !knownIds.has(p))) {
      throw validationFailed({ placement: 'Choose 1 to 4 different regions; the first is the origin.' });
    }
    let created = false;
    await tx(async client => {
      const exists = await client.query(`SELECT 1 FROM buckets WHERE name = $1`, [name]);
      if (exists.rows.length > 0) return;
      await client.query(`INSERT INTO buckets (name, workspace_slug, placement) VALUES ($1,$2,$3)`, [name, ws.slug, placement]);
      await client.query(
        `INSERT INTO lifecycle (bucket_name, noncurrent_days, keep_newest_noncurrent, abort_multipart_days) VALUES ($1, NULL, 0, NULL)`,
        [name]
      );
      created = true;
    });
    if (!created) {
      const existing = await one<{ workspace_slug: string }>(`SELECT workspace_slug FROM buckets WHERE name = $1`, [name]);
      void existing;
      throw fail(409, 'bucket_name_taken', 'That name is taken. Bucket names are unique across all of Farshore.');
    }
    const bucket = await bucketByName(name);
    const createdAt = await one<{ created_at: Date }>(`SELECT created_at FROM buckets WHERE name = $1`, [name]);
    sendJson(res, 201, {
      name: bucket!.name, placement: bucket!.placement, created_at: iso(createdAt!.created_at),
      object_count: bucket!.object_count, stored_bytes: Number(bucket!.stored_bytes),
    });
  });

  json.get('/api/w/{ws}/buckets/{bucket}', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    const createdAt = await one<{ created_at: Date }>(`SELECT created_at FROM buckets WHERE name = $1`, [bucket.name]);
    sendJson(res, 200, {
      name: bucket.name, placement: bucket.placement, created_at: iso(createdAt!.created_at),
      object_count: bucket.object_count, stored_bytes: Number(bucket.stored_bytes),
    });
  });

  json.get('/api/w/{ws}/buckets/{bucket}/lifecycle', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    const r = await one<{ noncurrent_days: number | null; keep_newest_noncurrent: number; abort_multipart_days: number | null; updated_at: Date | null }>(
      `SELECT noncurrent_days, keep_newest_noncurrent, abort_multipart_days, updated_at FROM lifecycle WHERE bucket_name = $1`, [bucket.name]
    );
    sendJson(res, 200, {
      noncurrent_days: r?.noncurrent_days ?? null,
      keep_newest_noncurrent: r?.keep_newest_noncurrent ?? 0,
      abort_multipart_days: r?.abort_multipart_days ?? null,
      updated_at: r?.updated_at ? iso(r.updated_at) : null,
    });
  });

  json.put('/api/w/{ws}/buckets/{bucket}/lifecycle', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (role !== 'developer' && role !== 'owner') {
      await auditDenied(role, ws.slug, auth, req.method, req.rawPath);
      throw forbidden();
    }
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) {
      if (k !== 'noncurrent_days' && k !== 'keep_newest_noncurrent' && k !== 'abort_multipart_days') errors[k] = "This field can't be set.";
    }
    for (const k of ['noncurrent_days', 'keep_newest_noncurrent', 'abort_multipart_days']) {
      if (!(k in body)) errors[k] = 'This field is required.';
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const nd = body.noncurrent_days, kn = body.keep_newest_noncurrent, am = body.abort_multipart_days;
    if (nd !== null && (typeof nd !== 'number' || !Number.isInteger(nd) || nd < 1 || nd > 3650)) {
      errors.noncurrent_days = 'Expire noncurrent versions after 1 to 3,650 days, or leave it off.';
    }
    if (typeof kn !== 'number' || !Number.isInteger(kn) || kn < 0 || kn > 100) {
      errors.keep_newest_noncurrent = 'Keep 0 to 100 newest noncurrent versions.';
    }
    if (am !== null && (typeof am !== 'number' || !Number.isInteger(am) || am < 1 || am > 365)) {
      errors.abort_multipart_days = 'Abort incomplete uploads after 1 to 365 days, or leave it off.';
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    await query(
      `UPDATE lifecycle SET noncurrent_days = $1, keep_newest_noncurrent = $2, abort_multipart_days = $3, updated_at = now() WHERE bucket_name = $4`,
      [nd, kn, am, bucket.name]
    );
    sendJson(res, 200, { noncurrent_days: nd, keep_newest_noncurrent: kn, abort_multipart_days: am, updated_at: iso(new Date()) });
  });
}

function isValidBucketName(name: string): boolean {
  if (name.length < 3 || name.length > 63) return false;
  if (name.startsWith('xn--')) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) return false;
  return true;
}
