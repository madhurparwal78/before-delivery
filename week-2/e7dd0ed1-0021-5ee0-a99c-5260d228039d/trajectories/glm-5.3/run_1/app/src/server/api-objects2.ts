import { sendJson, sendNoContent, type Router } from './http.js';
import { one, rows, query, tx, txLock } from './db.js';
import { config } from './config.js';
import {
  forbidden, invalidTransition, notFound, objectLocked, validationFailed,
  workspaceSuspended, fail,
} from './errors.js';
import { requireSession } from './auth.js';
import { sha256Hex, opaqueId } from './crypto.js';
import { audit } from './audit.js';
import {
  acknowledgeWrite, bucketByName, currentVersion, versionById, plainDelete, removeVersion,
  restoreVersion, isLocked, loadPlaintext,
} from './objects.js';
import { wsCtx, requireStepUp } from './api-ws.js';
import {
  isValidKey, tagsFromQuery, validateTags, metadataBytes, judgeContentType, downloadHeaders, SINGLE_UPLOAD_LIMIT,
} from './api-objects.js';

function iso(d: Date): string { return d.toISOString(); }

/** Metered egress: adds to the current window's row. */
async function meterEgress(ws: string, bucket: string, bytes: number): Promise<void> {
  const { recordUsage } = await import('./objects.js');
  await tx(async client => {
    await recordUsage(client, ws, bucket, 'egress-gb', bytes, new Date());
  });
}

async function meterRequestUnit(ws: string, bucket: string): Promise<void> {
  const { recordUsage } = await import('./objects.js');
  await tx(async client => {
    await recordUsage(client, ws, bucket, 'request-units', 1, new Date());
  });
}

export function registerObjectRoutes2(json: Router): void {
  json.put('/api/w/{ws}/buckets/{bucket}/object', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (role !== 'developer' && role !== 'owner') {
      await audit(ws.slug, auth.user.email, 'permission.denied', bucket.name, `${req.method} ${req.rawPath}`);
      throw forbidden();
    }
    if (ws.status === 'suspended') throw workspaceSuspended();

    const key = req.query.get('key') ?? '';
    if (!isValidKey(key)) throw validationFailed({ key: "This key can't be stored." });
    const declared = req.headers['x-upload-size'];
    const idemKey = req.headers['idempotency-key'];
    if (declared === undefined || !/^\d+$/.test(declared)) throw validationFailed({ size: 'Declare the upload size.' });
    const declaredSize = Number(declared);
    const ifMatch = req.headers['if-match'];
    const ifNoneMatch = req.headers['if-none-match'];
    if (idemKey !== undefined && (idemKey.length < 1 || idemKey.length > 128 || !/^[\x20-\x7e]+$/.test(idemKey))) {
      throw validationFailed({ idempotency_key: 'Idempotency keys are 1 to 128 printable ASCII characters.' });
    }

    // Quota before body checks, but after header-decidable checks.
    const plan = await one<{ storage_overage: string; included_storage_bytes: string }>(
      `SELECT p.storage_overage, p.included_storage_bytes::text AS included_storage_bytes FROM plans p JOIN workspaces w ON w.plan = p.id WHERE w.slug = $1`,
      [ws.slug]
    );
    const capped = plan?.storage_overage === 'none';
    if (capped && declaredSize > Number(plan!.included_storage_bytes)) {
      throw fail(409, 'quota_exceeded', 'This upload would put the workspace over its storage limit.', {
        extra: { quota_bytes: Number(plan!.included_storage_bytes) },
      });
    }

    // Idempotent replay.
    const body = req.rawBody ?? Buffer.alloc(0);
    if (idemKey !== undefined) {
      const stored = await one<{ status: number; response: Record<string, unknown>; body_hash: string; endpoint: string; bucket_name: string; obj_key: string }>(
        `SELECT status, response, body_hash, endpoint, bucket_name, obj_key FROM idempotency
         WHERE workspace_slug = $1 AND key = $2 AND created_at > now() - interval '${config.timing.idempotencyTtl} seconds'`,
        [ws.slug, idemKey]
      );
      if (stored) {
        const bodyHash = sha256Hex(body);
        if (stored.body_hash === bodyHash && stored.endpoint === req.rawPath && stored.bucket_name === bucket.name && stored.obj_key === key) {
          sendJson(res, stored.status, stored.response, { 'Idempotent-Replayed': 'true' });
          return;
        }
        throw fail(409, 'idempotency_key_reused', 'This idempotency key was used for a different request.');
      }
    }

    // Condition checks against the current version.
    const cur = await currentVersion(bucket.name, key);
    if (ifMatch !== undefined) {
      if (!cur) throw notFound();
      if (cur.etag !== ifMatch) {
        throw fail(412, 'precondition_failed', 'The object changed since you read it.', { extra: { current_etag: cur.etag } });
      }
    }
    if (ifNoneMatch !== undefined) {
      if (cur) {
        throw fail(412, 'precondition_failed', 'The object changed since you read it.', { extra: { current_etag: cur.etag } });
      }
    }

    // Size and limit checks.
    if (declaredSize !== body.length) {
      throw validationFailed({ size: `Declared size ${declaredSize} bytes does not match ${body.length} bytes received.` });
    }
    if (body.length > SINGLE_UPLOAD_LIMIT) {
      throw fail(413, 'payload_too_large', 'This upload is over the single-upload limit.');
    }

    // Metadata and tags.
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.startsWith('x-amz-meta-')) meta[k.slice('x-amz-meta-'.length)] = v;
    }
    if (metadataBytes(meta) > 2048) {
      throw validationFailed({ metadata: 'User metadata is limited to 2,048 bytes in total.' });
    }
    const tags = tagsFromQuery(req.headers['x-amz-tagging']);
    const tagErr = validateTags(tags);
    if (tagErr) throw validationFailed({ tags: tagErr });

    const judged = judgeContentType(body, req.headers['content-type'] ?? 'application/octet-stream');
    if (judged.refuse) throw validationFailed({ content: 'SVG files with scripts are not accepted.' });

    // Quota reservation under the workspace lock.
    if (capped) {
      const placed = bucket.placement.length;
      await txLock(`quota:${ws.slug}`, async () => {
        const sums = await one<{ stored: string; reserved: string }>(
          `SELECT COALESCE((SELECT SUM(stored_bytes) FROM buckets WHERE workspace_slug = $1),0)::text AS stored,
                  COALESCE((SELECT SUM(bytes) FROM quota_reservations WHERE workspace_slug = $1),0)::text AS reserved`,
          [ws.slug]
        );
        const total = BigInt(sums!.stored) + BigInt(sums!.reserved) + BigInt(declaredSize * placed);
        if (total > BigInt(plan!.included_storage_bytes)) {
          const e = fail(409, 'quota_exceeded', 'This upload would put the workspace over its storage limit.', {
            extra: {
              quota_bytes: Number(plan!.included_storage_bytes),
              stored_bytes: Number(sums!.stored),
              reserved_bytes: Number(sums!.reserved),
            },
          });
          throw e;
        }
        await query(`INSERT INTO quota_reservations (workspace_slug, upload_id, part_number, bytes) VALUES ($1, $2, 0, $3)`,
          [ws.slug, 'console:' + sha256Hex(body).slice(0, 24), declaredSize * placed]);
      });
    }

    const created = await acknowledgeWrite({
      bucket: bucket.name, key, bytes: body, contentType: judged.type,
      metadata: meta, tags,
    });
    if (capped) {
      await query(`DELETE FROM quota_reservations WHERE workspace_slug = $1 AND upload_id = $2`,
        [ws.slug, 'console:' + sha256Hex(body).slice(0, 24)]);
    }
    const replicas = await rows(`SELECT region, role, state, attempts, settled_at, settle_ms, error FROM replicas WHERE version_id = $1 ORDER BY position ASC`, [created.version_id]);
    const response = {
      bucket: bucket.name, key, version_id: created.version_id, etag: created.etag,
      size: body.length, content_type: judged.type, last_modified: iso(created.acknowledged_at),
      replicas: replicas.map(r => ({
        region: r.region, role: r.role, state: r.state, attempts: r.attempts,
        settled_at: r.settled_at ? iso(r.settled_at) : null, settle_ms: r.settle_ms, error: r.error,
      })),
    };
    if (idemKey !== undefined) {
      await query(
        `INSERT INTO idempotency (key, workspace_slug, endpoint, bucket_name, obj_key, body_hash, status, response)
         VALUES ($1,$2,$3,$4,$5,$6,201,$7)`,
        [idemKey, ws.slug, req.rawPath, bucket.name, key, sha256Hex(body), JSON.stringify(response)]
      );
    }
    await meterEgress(ws.slug, bucket.name, 0);
    await meterRequestUnit(ws.slug, bucket.name);
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(JSON.stringify(response)) });
    res.end(JSON.stringify(response));
  });

  json.get('/api/w/{ws}/buckets/{bucket}/object', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    const key = req.query.get('key') ?? '';
    const v = await currentVersion(bucket.name, key);
    if (!v) throw notFound();
    sendJson(res, 200, {
      key, version_id: v.version_id, etag: v.etag, size: Number(v.size),
      content_type: v.content_type, last_modified: iso(v.acknowledged_at),
      metadata: v.metadata, tags: v.tags,
    });
  });

  json.get('/api/w/{ws}/buckets/{bucket}/object/content', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (ws.status === 'suspended') throw workspaceSuspended();
    const key = req.query.get('key') ?? '';
    const versionQ = req.query.get('version');
    const v = versionQ ? await versionById(versionQ) : await currentVersion(bucket.name, key);
    if (!v || v.state === 'removed' || (versionQ && (v.bucket_name !== bucket.name || v.key !== key))) throw notFound();
    const bytes = await loadPlaintext(v);
    await meterEgress(ws.slug, bucket.name, bytes.length);
    await meterRequestUnit(ws.slug, bucket.name);
    void role;
    const headers = downloadHeaders(key, v.content_type);
    res.writeHead(200, { ...headers, 'Content-Length': bytes.length, 'ETag': v.etag, 'Last-Modified': v.acknowledged_at.toUTCString() });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });

  json.get('/api/w/{ws}/buckets/{bucket}/object/versions', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    const key = req.query.get('key') ?? '';
    const list = await rows<{
      version_id: string; etag: string; size: string; created_at: Date; state: string;
      noncurrent_since: Date | null; retain_until: Date | null; legal_hold: boolean;
    }>(
      `SELECT version_id, etag, size::text AS size, created_at, state, noncurrent_since, retain_until, legal_hold
       FROM versions WHERE bucket_name = $1 AND key = $2 AND state <> 'removed'
       ORDER BY created_at DESC, version_id DESC`, [bucket.name, key]
    );
    sendJson(res, 200, {
      versions: list.map(v => ({
        version_id: v.version_id, etag: v.etag, size: Number(v.size), created_at: iso(v.created_at),
        current: v.state === 'current',
        noncurrent_since: v.noncurrent_since ? iso(v.noncurrent_since) : null,
        retain_until: v.retain_until ? iso(v.retain_until) : null,
        legal_hold: v.legal_hold,
      })),
    });
  });

  json.delete('/api/w/{ws}/buckets/{bucket}/object', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (role !== 'developer' && role !== 'owner') {
      await audit(ws.slug, auth.user.email, 'permission.denied', bucket.name, `${req.method} ${req.rawPath}`);
      throw forbidden();
    }
    if (ws.status === 'suspended') throw workspaceSuspended();
    const key = req.query.get('key') ?? '';
    const v = await currentVersion(bucket.name, key);
    if (!v) throw notFound();
    await plainDelete(bucket.name, key, { ws: ws.slug });
    sendNoContent(res);
  });

  json.delete('/api/w/{ws}/buckets/{bucket}/object/version', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (role !== 'developer' && role !== 'owner') {
      await audit(ws.slug, auth.user.email, 'permission.denied', bucket.name, `${req.method} ${req.rawPath}`);
      throw forbidden();
    }
    if (ws.status === 'suspended') throw workspaceSuspended();
    const key = req.query.get('key') ?? '';
    const versionQ = req.query.get('version') ?? '';
    const v = await versionById(versionQ);
    if (!v || v.state === 'removed' || v.bucket_name !== bucket.name || v.key !== key) throw notFound();
    if (v.state === 'current') throw invalidTransition('current', 'removed');
    if (isLocked(v)) throw objectLocked(v.retain_until ? iso(v.retain_until) : null, v.legal_hold);
    await removeVersion(v, 'request', true);
    sendNoContent(res);
  });

  json.put('/api/w/{ws}/buckets/{bucket}/object/retention', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (role !== 'developer' && role !== 'owner') {
      await audit(ws.slug, auth.user.email, 'permission.denied', bucket.name, `${req.method} ${req.rawPath}`);
      throw forbidden();
    }
    const key = req.query.get('key') ?? '';
    const versionQ = req.query.get('version') ?? '';
    const v = await versionById(versionQ);
    if (!v || v.state === 'removed' || v.bucket_name !== bucket.name || v.key !== key) throw notFound();
    const body = req.rawBody ? JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown> : {};
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'retain_until') errors[k] = "This field can't be set.";
    if (!('retain_until' in body)) errors.retain_until = 'This field is required.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const t = Date.parse(String(body.retain_until ?? ''));
    const now = new Date();
    if (Number.isNaN(t) || t <= now.getTime() || t > now.getTime() + 3650 * config.timing.day * 1000) {
      throw validationFailed({ retain_until: 'Pick a time after now and within 3,650 days.' });
    }
    const newUntil = new Date(t);
    if (v.retain_until && v.retain_until.getTime() > now.getTime()) {
      if (newUntil.getTime() < v.retain_until.getTime()) {
        throw fail(409, 'retention_locked', 'Retention can be extended but not shortened.');
      }
      if (newUntil.getTime() === v.retain_until.getTime()) {
        sendJson(res, 200, { version_id: v.version_id, retain_until: iso(v.retain_until), legal_hold: v.legal_hold, locked: true });
        return;
      }
    }
    await query(`UPDATE versions SET retain_until = $1 WHERE version_id = $2`, [newUntil, v.version_id]);
    sendJson(res, 200, { version_id: v.version_id, retain_until: iso(newUntil), legal_hold: v.legal_hold, locked: isLocked({ retain_until: newUntil, legal_hold: v.legal_hold }, now) });
  });

  json.put('/api/w/{ws}/buckets/{bucket}/object/legal-hold', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (role !== 'owner') {
      await audit(ws.slug, auth.user.email, 'permission.denied', bucket.name, `${req.method} ${req.rawPath}`);
      throw forbidden();
    }
    const key = req.query.get('key') ?? '';
    const versionQ = req.query.get('version') ?? '';
    const v = await versionById(versionQ);
    if (!v || v.state === 'removed' || v.bucket_name !== bucket.name || v.key !== key) throw notFound();
    const body = req.rawBody ? JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown> : {};
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'on') errors[k] = "This field can't be set.";
    if (!('on' in body)) errors.on = 'This field is required.';
    if (typeof body.on !== 'boolean') errors.on = 'Choose on or off.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    if (!body.on) await requireStepUp(auth, ws.slug);
    if (v.legal_hold === body.on) {
      sendJson(res, 200, { version_id: v.version_id, retain_until: v.retain_until ? iso(v.retain_until) : null, legal_hold: v.legal_hold, locked: isLocked(v) });
      return;
    }
    await query(`UPDATE versions SET legal_hold = $1 WHERE version_id = $2`, [body.on, v.version_id]);
    await audit(ws.slug, auth.user.email, 'legal_hold.changed', key, `${v.version_id} ${body.on ? 'on' : 'off'}`);
    sendJson(res, 200, { version_id: v.version_id, retain_until: v.retain_until ? iso(v.retain_until) : null, legal_hold: Boolean(body.on), locked: isLocked({ retain_until: v.retain_until, legal_hold: Boolean(body.on) }) });
  });

  json.get('/api/w/{ws}/buckets/{bucket}/object/replicas', async (req, res) => {
    const auth = await requireSession(req);
    const { ws } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    const key = req.query.get('key') ?? '';
    const versionQ = req.query.get('version');
    const v = versionQ ? await versionById(versionQ) : await currentVersion(bucket.name, key);
    if (!v || (versionQ && (v.bucket_name !== bucket.name || v.key !== key))) throw notFound();
    const list = await rows(`SELECT region, role, state, attempts, settled_at, settle_ms, error FROM replicas WHERE version_id = $1 ORDER BY position ASC`, [v.version_id]);
    const ready = list.every(r => r.state === 'settled');
    sendJson(res, 200, {
      version_id: v.version_id, etag: v.etag, acknowledged_at: iso(v.acknowledged_at), ready,
      replicas: list.map(r => ({
        region: r.region, role: r.role, state: r.state, attempts: r.attempts,
        settled_at: r.settled_at ? iso(r.settled_at) : null, settle_ms: r.settle_ms, error: r.error,
      })),
    });
  });

  json.post('/api/w/{ws}/buckets/{bucket}/object/replicas/{region}/retry', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (role !== 'developer' && role !== 'owner') {
      await audit(ws.slug, auth.user.email, 'permission.denied', bucket.name, `${req.method} ${req.rawPath}`);
      throw forbidden();
    }
    if (ws.status === 'suspended') throw workspaceSuspended();
    const key = req.query.get('key') ?? '';
    const versionQ = req.query.get('version') ?? '';
    const v = versionQ ? await versionById(versionQ) : await currentVersion(bucket.name, key);
    if (!v || (versionQ && (v.bucket_name !== bucket.name || v.key !== key))) throw notFound();
    const region = req.params['region'];
    const rep = await one<{ state: string }>(`SELECT state FROM replicas WHERE version_id = $1 AND region = $2`, [v.version_id, region]);
    if (!rep) throw notFound();
    if (rep.state !== 'failed') throw invalidTransition(rep.state, 'pending');
    await query(`UPDATE replicas SET state = 'pending', error = NULL WHERE version_id = $1 AND region = $2`, [v.version_id, region]);
    const after = await one<{ state: string; attempts: number }>(`SELECT state, attempts FROM replicas WHERE version_id = $1 AND region = $2`, [v.version_id, region]);
    sendJson(res, 202, { region, role: 'replica', state: 'pending', attempts: after!.attempts, settled_at: null, settle_ms: null, error: null });
  });

  json.post('/api/w/{ws}/buckets/{bucket}/objects/delete', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    const bucket = await bucketByName(req.params['bucket']);
    if (!bucket || bucket.workspace_slug !== ws.slug) throw notFound();
    if (role !== 'developer' && role !== 'owner') {
      await audit(ws.slug, auth.user.email, 'permission.denied', bucket.name, `${req.method} ${req.rawPath}`);
      throw forbidden();
    }
    if (ws.status === 'suspended') throw workspaceSuspended();
    const body = req.rawBody ? JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown> : {};
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'keys') errors[k] = "This field can't be set.";
    if (!('keys' in body)) errors.keys = 'This field is required.';
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : null;
    if (keys && (keys.length < 1 || keys.length > 1000 || new Set(keys).size !== keys.length)) {
      errors.keys = 'Choose 1 to 1,000 different keys.';
    }
    if (keys && keys.some(k => !isValidKey(k))) errors.keys = 'Choose 1 to 1,000 different keys.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const idemKey = req.headers['idempotency-key'];
    if (idemKey !== undefined) {
      const stored = await one<{ status: number; response: Record<string, unknown>; body_hash: string; endpoint: string }>(
        `SELECT status, response, body_hash, endpoint FROM idempotency
         WHERE workspace_slug = $1 AND key = $2 AND created_at > now() - interval '${config.timing.idempotencyTtl} seconds'`,
        [ws.slug, idemKey]
      );
      if (stored) {
        const bodyHash = sha256Hex(req.rawBody ?? Buffer.alloc(0));
        if (stored.body_hash === bodyHash && stored.endpoint === req.rawPath) {
          sendJson(res, stored.status, stored.response, { 'Idempotent-Replayed': 'true' });
          return;
        }
        throw fail(409, 'idempotency_key_reused', 'This idempotency key was used for a different request.');
      }
    }
    const results: Array<{ key: string; outcome: string; version_id: string | null }> = [];
    const deleted: Array<{ key: string; versionId: string }> = [];
    for (const k of keys!) {
      const v = await currentVersion(bucket.name, k);
      if (!v) { results.push({ key: k, outcome: 'not_found', version_id: null }); continue; }
      await plainDelete(bucket.name, k, { ws: ws.slug });
      results.push({ key: k, outcome: 'deleted', version_id: v.version_id });
      deleted.push({ key: k, versionId: v.version_id });
    }
    let batchId: string | null = null;
    let undoUntil: string | null = null;
    if (deleted.length > 0) {
      batchId = opaqueId('b', 10);
      const until = new Date(Date.now() + config.timing.undo * 1000);
      await tx(async client => {
        await client.query(`INSERT INTO batches (id, workspace_slug, bucket_name, state, undo_until) VALUES ($1,$2,$3,'open',$4)`,
          [batchId, ws.slug, bucket.name, until]);
        for (let i = 0; i < deleted.length; i++) {
          await client.query(`INSERT INTO batch_items (batch_id, key, version_id, position) VALUES ($1,$2,$3,$4)`,
            [batchId, deleted[i].key, deleted[i].versionId, i]);
        }
      });
      undoUntil = iso(until);
    }
    const response = { batch_id: batchId, undo_until: undoUntil, results };
    if (idemKey !== undefined) {
      await query(
        `INSERT INTO idempotency (key, workspace_slug, endpoint, bucket_name, obj_key, body_hash, status, response)
         VALUES ($1,$2,$3,$4,'',$5,200,$6)`,
        [idemKey, ws.slug, req.rawPath, bucket.name, sha256Hex(req.rawBody ?? Buffer.alloc(0)), JSON.stringify(response)]
      );
    }
    sendJson(res, 200, response);
  });

  json.post('/api/w/{ws}/batches/{batch_id}/undo', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'developer' && role !== 'owner') {
      await audit(ws.slug, auth.user.email, 'permission.denied', req.rawPath, `${req.method} ${req.rawPath}`);
      throw forbidden();
    }
    if (ws.status === 'suspended') throw workspaceSuspended();
    const batch = await one<{ id: string; workspace_slug: string; bucket_name: string; state: string; undo_until: Date }>(
      `SELECT id, workspace_slug, bucket_name, state, undo_until FROM batches WHERE id = $1`, [req.params['batch_id']]
    );
    if (!batch || batch.workspace_slug !== ws.slug) throw notFound();
    if (batch.state === 'undone') throw invalidTransition('undone', 'undone');
    if (batch.undo_until.getTime() <= Date.now()) {
      await query(`UPDATE batches SET state = 'expired' WHERE id = $1`, [batch.id]);
      throw fail(410, 'undo_expired', 'The undo window has closed.');
    }
    const items = await rows<{ key: string; version_id: string; position: number }>(
      `SELECT key, version_id, position FROM batch_items WHERE batch_id = $1 ORDER BY position ASC`, [batch.id]
    );
    const results: Array<{ key: string; outcome: string; version_id: string | null }> = [];
    for (const item of items) {
      const cur = await currentVersion(batch.bucket_name, item.key);
      const v = await versionById(item.version_id);
      if (!v || v.state === 'removed') { results.push({ key: item.key, outcome: 'gone', version_id: null }); continue; }
      if (cur) { results.push({ key: item.key, outcome: 'newer_version', version_id: cur.version_id }); continue; }
      await restoreVersion(v, batch.bucket_name, ws.slug);
      results.push({ key: item.key, outcome: 'restored', version_id: v.version_id });
    }
    await query(`UPDATE batches SET state = 'undone' WHERE id = $1`, [batch.id]);
    sendJson(res, 200, { batch_id: batch.id, state: 'undone', results });
  });
}
