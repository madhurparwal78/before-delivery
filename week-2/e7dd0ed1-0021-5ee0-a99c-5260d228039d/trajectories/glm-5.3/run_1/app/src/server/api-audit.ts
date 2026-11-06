import { sendJson, type Router } from './http.js';
import { one, rows, query, tx } from './db.js';
import { config } from './config.js';
import { fail, forbidden, notFound, validationFailed } from './errors.js';
import { requireSession } from './auth.js';
import { workspaceKey, wrapDataKey, unwrapDataKey } from './crypto.js';
import { audit, csvField, verifyChain, AUDIT_ACTIONS } from './audit.js';
import { wsCtx } from './api-ws.js';

function iso(d: Date): string { return d.toISOString(); }
// ---- Encryption ----

export function registerEncryptionRoutes(json: Router): void {
  json.get('/api/w/{ws}/encryption', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const w = await one<{ key_generation: number; key_rotated_at: Date | null }>(
      `SELECT key_generation, key_rotated_at FROM workspaces WHERE slug = $1`, [ws.slug]
    );
    const counts = await rows<{ key_generation: number; c: string }>(
      `SELECT key_generation, count(*)::text AS c FROM (
         SELECT key_generation FROM versions WHERE bucket_name IN (SELECT name FROM buckets WHERE workspace_slug = $1) AND state <> 'removed'
         UNION ALL
         SELECT key_generation FROM multipart_uploads WHERE bucket_name IN (SELECT name FROM buckets WHERE workspace_slug = $1)
       ) t GROUP BY key_generation`, [ws.slug]
    );
    const wrapped: Record<string, number> = {};
    for (const c of counts) wrapped[String(c.key_generation)] = Number(c.c);
    sendJson(res, 200, { generation: w!.key_generation, rotated_at: w!.key_rotated_at ? iso(w!.key_rotated_at) : null, wrapped });
  });

  json.post('/api/w/{ws}/encryption/rotate', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const { requireStepUp } = await import('./api-ws.js');
    await requireStepUp(auth, ws.slug);
    const started = await tx(async client => {
      const r = await client.query(
        `UPDATE workspaces SET rotation_running = true
         WHERE slug = $1 AND rotation_running = false RETURNING slug`, [ws.slug]
      );
      return r.rowCount ?? 0;
    });
    if (started === 0) throw fail(409, 'rotation_in_progress', 'Another rotation is running.');
    try {
      const w = await one<{ key_generation: number }>(`SELECT key_generation FROM workspaces WHERE slug = $1`, [ws.slug]);
      const fromGen = w!.key_generation;
      const toGen = fromGen + 1;
      const fromKey = workspaceKey(config.secretKey, ws.slug, fromGen);
      const toKey = workspaceKey(config.secretKey, ws.slug, toGen);
      const versions = await rows<{ version_id: string; wrapped_key: string }>(
        `SELECT v.version_id, v.wrapped_key FROM versions v
         JOIN buckets b ON b.name = v.bucket_name
         WHERE b.workspace_slug = $1 AND v.state <> 'removed'`, [ws.slug]
      );
      let rewrapped = 0;
      for (const v of versions) {
        const dk = unwrapDataKey(fromKey, v.wrapped_key);
        if (!dk) continue;
        await query(`UPDATE versions SET wrapped_key = $1, key_generation = $2 WHERE version_id = $3`,
          [wrapDataKey(toKey, dk), toGen, v.version_id]);
        rewrapped++;
      }
      const uploads = await rows<{ upload_id: string; wrapped_key: string }>(
        `SELECT u.upload_id, u.wrapped_key FROM multipart_uploads u
         JOIN buckets b ON b.name = u.bucket_name WHERE b.workspace_slug = $1`, [ws.slug]
      );
      for (const u of uploads) {
        const dk = unwrapDataKey(fromKey, u.wrapped_key);
        if (!dk) continue;
        await query(`UPDATE multipart_uploads SET wrapped_key = $1, key_generation = $2 WHERE upload_id = $3`,
          [wrapDataKey(toKey, dk), toGen, u.upload_id]);
        rewrapped++;
      }
      await query(`UPDATE workspaces SET key_generation = $1, key_rotated_at = now(), rotation_running = false WHERE slug = $2`,
        [toGen, ws.slug]);
      await audit(ws.slug, auth.user.email, 'encryption.rotated', ws.slug, `generation ${toGen}`);
      sendJson(res, 200, { generation: toGen, rewrapped });
    } catch (e) {
      await query(`UPDATE workspaces SET rotation_running = false WHERE slug = $1`, [ws.slug]);
      throw e;
    }
  });
}

// ---- Audit trail ----

export function registerAuditRoutes(json: Router): void {
  json.get('/api/w/{ws}/audit', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const action = req.query.get('action') ?? '';
    const actor = req.query.get('actor') ?? '';
    const cursor = req.query.get('cursor');
    const errors: Record<string, string> = {};
    if (action && !AUDIT_ACTIONS.includes(action as never)) errors.action = 'Choose an action from the list.';
    if (actor && (actor.length < 1 || actor.length > 320)) errors.actor = 'Actors are 1 to 320 characters.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    let before: number | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (typeof decoded?.before !== 'number') throw new Error('bad');
        before = decoded.before;
      } catch { throw validationFailed({ cursor: 'This page link is no longer valid.' }); }
    }
    const params: unknown[] = [ws.slug];
    let where = `workspace_slug = $1`;
    if (action) { params.push(action); where += ` AND action = $${params.length}`; }
    if (actor) { params.push(actor); where += ` AND actor = $${params.length}`; }
    let order = `ORDER BY audit_entries.seq DESC`;
    if (before !== null) { params.push(before); where += ` AND seq < $${params.length}`; }
    const list = await rows<{ seq_text: string; at: Date; actor: string; action: string; target: string; detail: string; hash: string }>(
      `SELECT seq::text AS seq_text, at, actor, action, target, detail, hash FROM audit_entries
       WHERE ${where} ${order} LIMIT 50`, params
    );
    const nextCursor = list.length === 50
      ? Buffer.from(JSON.stringify({ before: Number(list[list.length - 1].seq_text) })).toString('base64url')
      : null;
    sendJson(res, 200, {
      entries: list.map(e => ({
        seq: Number(e.seq_text), at: iso(e.at), actor: e.actor, action: e.action, target: e.target, detail: e.detail, hash: e.hash,
      })),
      next_cursor: nextCursor,
    });
  });

  json.get('/api/w/{ws}/audit/export.csv', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const action = req.query.get('action') ?? '';
    const actor = req.query.get('actor') ?? '';
    const errors: Record<string, string> = {};
    if (action && !AUDIT_ACTIONS.includes(action as never)) errors.action = 'Choose an action from the list.';
    if (actor && (actor.length < 1 || actor.length > 320)) errors.actor = 'Actors are 1 to 320 characters.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const params: unknown[] = [ws.slug];
    let where = `workspace_slug = $1`;
    if (action) { params.push(action); where += ` AND action = $${params.length}`; }
    if (actor) { params.push(actor); where += ` AND actor = $${params.length}`; }
    const list = await rows<{ seq_text: string; at: Date; actor: string; action: string; target: string; detail: string; prev_hash: string; hash: string }>(
      `SELECT seq::text AS seq_text, at, actor, action, target, detail, prev_hash, hash FROM audit_entries
       WHERE ${where} ORDER BY audit_entries.seq ASC`, params
    );
    let out = 'seq,at_utc,actor,action,target,detail,prev_hash,hash\n';
    for (const e of list) {
      out += [e.seq_text, e.at.toISOString().replace(/\.\d{3}Z$/, 'Z'), e.actor, e.action, e.target, e.detail, e.prev_hash, e.hash]
        .map(csvField).join(',') + '\n';
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="farshore-${ws.slug}-audit.csv"`,
    });
    res.end(out);
  });

  json.get('/api/w/{ws}/audit/verify', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    sendJson(res, 200, await verifyChain(ws.slug));
  });

  // No edits allowed on audit paths: PUT, PATCH and DELETE answer 404.
  json.put('/api/w/{ws}/audit', async () => { throw notFound(); });
  json.patch('/api/w/{ws}/audit', async () => { throw notFound(); });
  json.delete('/api/w/{ws}/audit', async () => { throw notFound(); });
}
