import { sendJson, sendNoContent, type Router } from './http.js';
import { one, rows, query, tx } from './db.js';
import { config } from './config.js';
import { fail, forbidden, invalidTransition, notFound, validationFailed } from './errors.js';
import { requireSession } from './auth.js';
import { seal, accessKeyId, accessKeySecret, signingSecret, opaqueId } from './crypto.js';
import { audit } from './audit.js';
import { queueMail, mailTime } from './mail.js';
import { wsCtx, requireStepUp } from './api-ws.js';

function iso(d: Date): string { return d.toISOString(); }
function jsonBodyOf(req: { rawBody: Buffer | null }): Record<string, unknown> {
  if (!req.rawBody || req.rawBody.length === 0) return {};
  try { return JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}

// ---- Access keys ----

interface KeyRow {
  key_id: string; description: string; permission: string; buckets: string[] | null; prefix: string | null;
  expires_at: Date | null; state: string; last_used_at: Date | null;
  prev_expires_at: Date | null; prev_last_used_at: Date | null; created_at: Date;
}

function keyView(k: KeyRow): Record<string, unknown> {
  const expired = k.expires_at !== null && k.expires_at.getTime() <= Date.now();
  const prevLive = k.prev_expires_at !== null && k.prev_expires_at.getTime() > Date.now();
  return {
    key_id: k.key_id, description: k.description, permission: k.permission,
    buckets: k.buckets, prefix: k.prefix,
    expires_at: k.expires_at ? iso(k.expires_at) : null,
    expired, state: k.state,
    created_at: iso(k.created_at), last_used_at: k.last_used_at ? iso(k.last_used_at) : null,
    previous_secret_expires_at: prevLive && k.state === 'active' && !expired ? iso(k.prev_expires_at!) : null,
    previous_secret_last_used_at: k.prev_last_used_at ? iso(k.prev_last_used_at) : null,
  };
}

async function keyRow(keyId: string): Promise<KeyRow | null> {
  return one<KeyRow>(
    `SELECT key_id, description, permission, buckets, prefix, expires_at, state, last_used_at,
            prev_expires_at, prev_last_used_at, created_at
     FROM access_keys WHERE key_id = $1 AND deleted_at IS NULL`, [keyId]
  );
}

export function registerKeyRoutes(json: Router): void {
  json.get('/api/w/{ws}/keys', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const list = await rows<KeyRow>(
      `SELECT key_id, description, permission, buckets, prefix, expires_at, state, last_used_at,
              prev_expires_at, prev_last_used_at, created_at
       FROM access_keys WHERE workspace_slug = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [ws.slug]
    );
    sendJson(res, 200, { keys: list.map(keyView) });
  });

  json.post('/api/w/{ws}/keys', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    await requireStepUp(auth, ws.slug);
    const body = jsonBodyOf(req);
    const allowed = ['description', 'permission', 'buckets', 'prefix', 'expires_at'];
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (!allowed.includes(k)) errors[k] = "This field can't be set.";
    for (const k of ['description', 'permission', 'buckets']) {
      if (!(k in body)) errors[k] = 'This field is required.';
    }
    const description = String(body.description ?? '');
    if (description.length > 140) errors.description = 'Descriptions are limited to 140 characters.';
    const permission = String(body.permission ?? '');
    if (!['read', 'read-write'].includes(permission)) errors.permission = 'Choose read or read-write.';
    let buckets: string[] | null = null;
    if (body.buckets !== null && body.buckets !== undefined) {
      if (!Array.isArray(body.buckets)) { errors.buckets = 'Choose buckets from this workspace.'; }
      else {
        buckets = (body.buckets as unknown[]).map(String);
        const known = await rows<{ name: string }>(`SELECT name FROM buckets WHERE workspace_slug = $1`, [ws.slug]);
        const knownSet = new Set(known.map(r => r.name));
        if (buckets.some(b => !knownSet.has(b))) errors.buckets = 'Choose buckets from this workspace.';
      }
    }
    let prefix: string | null = null;
    if (body.prefix !== null && body.prefix !== undefined) {
      prefix = String(body.prefix);
      if (Buffer.byteLength(prefix, 'utf8') < 1 || Buffer.byteLength(prefix, 'utf8') > 1024) {
        errors.prefix = 'Prefixes are 1 to 1,024 bytes and follow the key rules.';
      } else if (/^\/|\\|[\x00-\x1f\x7f]/.test(prefix)) {
        errors.prefix = 'Prefixes are 1 to 1,024 bytes and follow the key rules.';
      } else if (prefix.split('/').some((seg) => seg === '.' || seg === '..')) {
        errors.prefix = 'Prefixes are 1 to 1,024 bytes and follow the key rules.';
      }
    }
    let expiresAt: Date | null = null;
    if (body.expires_at !== null && body.expires_at !== undefined) {
      const t = Date.parse(String(body.expires_at));
      if (Number.isNaN(t)) errors.expires_at = 'Pick a time after now and within 365 days.';
      else {
        expiresAt = new Date(t);
        if (t <= Date.now() || t > Date.now() + 365 * 86_400 * 1000) errors.expires_at = 'Pick a time after now and within 365 days.';
      }
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const keyId = accessKeyId();
    const secret = accessKeySecret();
    await query(
      `INSERT INTO access_keys (key_id, workspace_slug, description, permission, buckets, prefix, expires_at, state, sealed_secret)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)`,
      [keyId, ws.slug, description, permission, buckets, prefix, expiresAt, seal(config.secretKey, secret)]
    );
    await audit(ws.slug, auth.user.email, 'access_key.created', keyId, description);
    const owners = await rows<{ email: string }>(
      `SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_slug = $1 AND m.role = 'owner'`, [ws.slug]
    );
    for (const o of owners) {
      await queueMail(o.email, `New access key ${keyId} in ${ws.name}`,
        `A new access key was created in ${ws.name}.\n\nKey ID: ${keyId}\nDescription: ${description}\nPermission: ${permission}\nCreated by: ${auth.user.name}\n`);
    }
    const k = await keyRow(keyId);
    sendJson(res, 201, { ...keyView(k!), secret });
  });

  json.post('/api/w/{ws}/keys/{key_id}/rotate', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    await requireStepUp(auth, ws.slug);
    const k = await keyRow(req.params['key_id']);
    if (!k || !(await keyInWs(k.key_id, ws.slug))) throw notFound();
    if (k.state !== 'active' || k.expires_at !== null && k.expires_at.getTime() <= Date.now()) {
      throw invalidTransition(k.state === 'active' ? 'expired' : k.state, 'rotated');
    }
    const live = k.prev_expires_at !== null && k.prev_expires_at.getTime() > Date.now();
    if (live) throw fail(409, 'rotation_in_progress', "This key's previous secret is still live.");
    const newSecret = accessKeySecret();
    const overlapEnd = new Date(Date.now() + config.timing.keyOverlap * 1000);
    const rotated = await tx(async client => {
      const r = await client.query(
        `UPDATE access_keys SET sealed_secret = $1, sealed_prev_secret = sealed_secret,
          prev_expires_at = $2, prev_last_used_at = NULL
         WHERE key_id = $3 AND (prev_expires_at IS NULL OR prev_expires_at <= now())
         RETURNING key_id`, [seal(config.secretKey, newSecret), overlapEnd, k.key_id]
      );
      return r.rowCount ?? 0;
    });
    if (rotated === 0) throw fail(409, 'rotation_in_progress', "This key's previous secret is still live.");
    await audit(ws.slug, auth.user.email, 'access_key.rotated', k.key_id, '');
    const owners = await rows<{ email: string }>(
      `SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_slug = $1 AND m.role = 'owner'`, [ws.slug]
    );
    for (const o of owners) {
      await queueMail(o.email, `Access key ${k.key_id} rotated in ${ws.name}`,
        `Access key ${k.key_id} was rotated in ${ws.name}. The previous secret stops working at ${mailTime(overlapEnd)}.\n`);
    }
    const after = await keyRow(k.key_id);
    sendJson(res, 200, { ...keyView(after!), secret: newSecret });
  });

  json.post('/api/w/{ws}/keys/{key_id}/disable', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const k = await keyRow(req.params['key_id']);
    if (!k || !(await keyInWs(k.key_id, ws.slug))) throw notFound();
    if (k.state !== 'active') throw invalidTransition('disabled', 'disabled');
    await query(`UPDATE access_keys SET state = 'disabled', prev_expires_at = NULL, sealed_prev_secret = NULL WHERE key_id = $1`, [k.key_id]);
    await audit(ws.slug, auth.user.email, 'access_key.disabled', k.key_id, '');
    const after = await keyRow(k.key_id);
    sendJson(res, 200, keyView(after!));
  });

  json.delete('/api/w/{ws}/keys/{key_id}', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const k = await keyRow(req.params['key_id']);
    if (!k || !(await keyInWs(k.key_id, ws.slug))) throw notFound();
    if (k.state === 'active') throw invalidTransition('active', 'deleted');
    await query(`UPDATE access_keys SET state = 'deleted', deleted_at = now() WHERE key_id = $1`, [k.key_id]);
    await audit(ws.slug, auth.user.email, 'access_key.deleted', k.key_id, '');
    sendNoContent(res);
  });
}

async function keyInWs(keyId: string, ws: string): Promise<boolean> {
  const r = await one<{ c: string }>(`SELECT count(*)::text AS c FROM access_keys WHERE key_id = $1 AND workspace_slug = $2`, [keyId, ws]);
  return Number(r!.c) > 0;
}

// ---- Webhooks ----

export function registerWebhookRoutes(json: Router): void {
  json.get('/api/w/{ws}/webhooks', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const list = await rows<{ id: string; url: string; events: string[]; buckets: string[] | null; description: string; state: string; created_at: Date }>(
      `SELECT id, url, events, buckets, description, state, created_at FROM webhook_endpoints
       WHERE workspace_slug = $1 ORDER BY created_at DESC`, [ws.slug]
    );
    sendJson(res, 200, {
      endpoints: list.map(e => ({
        id: e.id, url: e.url, events: e.events, buckets: e.buckets, description: e.description,
        state: e.state, created_at: iso(e.created_at),
      })),
    });
  });

  json.post('/api/w/{ws}/webhooks', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const body = jsonBodyOf(req);
    const allowed = ['url', 'events', 'buckets', 'description'];
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (!allowed.includes(k)) errors[k] = "This field can't be set.";
    for (const k of ['url', 'events', 'description']) {
      if (!(k in body)) errors[k] = 'This field is required.';
    }
    const url = String(body.url ?? '');
    let urlOk = false;
    try {
      const u = new URL(url);
      urlOk = (u.protocol === 'http:' || u.protocol === 'https:') && u.username === '' && u.password === '' && u.hash === '';
    } catch { urlOk = false; }
    if (!urlOk || Buffer.byteLength(url, 'utf8') > 2048) errors.url = 'Enter an http or https URL without credentials.';
    const events = Array.isArray(body.events) ? (body.events as unknown[]).map(String) : [];
    const eventTypes = ['object.created', 'object.deleted', 'object.restored', 'version.removed'];
    if (events.length < 1 || events.length > 4 || new Set(events).size !== events.length || events.some(e => !eventTypes.includes(e))) {
      errors.events = 'Choose one or more event types.';
    }
    let buckets: string[] | null = null;
    if (body.buckets !== null && body.buckets !== undefined) {
      if (!Array.isArray(body.buckets)) errors.buckets = 'Choose buckets from this workspace, or all buckets.';
      else {
        buckets = (body.buckets as unknown[]).map(String);
        const known = await rows<{ name: string }>(`SELECT name FROM buckets WHERE workspace_slug = $1`, [ws.slug]);
        const knownSet = new Set(known.map(r => r.name));
        if (buckets.some(b => !knownSet.has(b))) errors.buckets = 'Choose buckets from this workspace, or all buckets.';
      }
    }
    const description = String(body.description ?? '');
    if (description.length > 140) errors.description = 'Descriptions are limited to 140 characters.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const count = await one<{ c: string }>(`SELECT count(*)::text AS c FROM webhook_endpoints WHERE workspace_slug = $1`, [ws.slug]);
    if (Number(count!.c) >= 5) throw fail(409, 'endpoint_limit', 'This workspace already has 5 webhook endpoints.');
    const id = opaqueId('we', 10);
    const secret = signingSecret();
    await query(
      `INSERT INTO webhook_endpoints (id, workspace_slug, url, events, buckets, description, state, sealed_secret)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`,
      [id, ws.slug, url, events, buckets, description, seal(config.secretKey, secret)]
    );
    sendJson(res, 201, {
      id, url, events, buckets, description, state: 'active', created_at: iso(new Date()), secret,
    });
  });

  json.post('/api/w/{ws}/webhooks/{id}/disable', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const ep = await one<{ id: string; state: string; workspace_slug: string }>(
      `SELECT id, state, workspace_slug FROM webhook_endpoints WHERE id = $1`, [req.params['id']]
    );
    if (!ep || ep.workspace_slug !== ws.slug) throw notFound();
    if (ep.state !== 'active') throw invalidTransition('disabled', 'disabled');
    await query(`UPDATE webhook_endpoints SET state = 'disabled' WHERE id = $1`, [ep.id]);
    const after = await one<{ url: string; events: string[]; buckets: string[] | null; description: string; state: string; created_at: Date }>(
      `SELECT url, events, buckets, description, state, created_at FROM webhook_endpoints WHERE id = $1`, [ep.id]
    );
    sendJson(res, 200, { id: ep.id, ...after! });
  });

  json.post('/api/w/{ws}/webhooks/{id}/enable', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const ep = await one<{ id: string; state: string; workspace_slug: string }>(
      `SELECT id, state, workspace_slug FROM webhook_endpoints WHERE id = $1`, [req.params['id']]
    );
    if (!ep || ep.workspace_slug !== ws.slug) throw notFound();
    if (ep.state !== 'disabled') throw invalidTransition('active', 'active');
    await query(`UPDATE webhook_endpoints SET state = 'active' WHERE id = $1`, [ep.id]);
    const after = await one<{ url: string; events: string[]; buckets: string[] | null; description: string; state: string; created_at: Date }>(
      `SELECT url, events, buckets, description, state, created_at FROM webhook_endpoints WHERE id = $1`, [ep.id]
    );
    sendJson(res, 200, { id: ep.id, ...after! });
  });

  json.delete('/api/w/{ws}/webhooks/{id}', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const ep = await one<{ id: string; state: string; workspace_slug: string }>(
      `SELECT id, state, workspace_slug FROM webhook_endpoints WHERE id = $1`, [req.params['id']]
    );
    if (!ep || ep.workspace_slug !== ws.slug) throw notFound();
    if (ep.state !== 'disabled') throw invalidTransition('active', 'deleted');
    await query(`DELETE FROM webhook_endpoints WHERE id = $1`, [ep.id]);
    sendNoContent(res);
  });

  json.get('/api/w/{ws}/webhooks/{id}/deliveries', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const ep = await one<{ id: string; workspace_slug: string }>(
      `SELECT id, workspace_slug FROM webhook_endpoints WHERE id = $1`, [req.params['id']]
    );
    if (!ep || ep.workspace_slug !== ws.slug) throw notFound();
    const list = await rows<{
      id: string; event_id: string; event_type: string; sequence: string; state: string; attempts: number;
      last_status: number | null; last_error: string | null; next_attempt_at: Date | null; delivered_at: Date | null;
    }>(
      `SELECT d.id, d.event_id, ev.type AS event_type, d.sequence::text AS sequence, d.state, d.attempts,
              d.last_status, d.last_error, d.next_attempt_at, d.delivered_at
       FROM webhook_deliveries d JOIN webhook_events ev ON ev.id = d.event_id
       WHERE d.endpoint_id = $1 ORDER BY d.sequence DESC LIMIT 50`, [ep.id]
    );
    sendJson(res, 200, {
      deliveries: list.map(d => ({
        id: d.id, event_id: d.event_id, event_type: d.event_type, sequence: Number(d.sequence),
        state: d.state, attempts: d.attempts, last_status: d.last_status, last_error: d.last_error,
        next_attempt_at: d.next_attempt_at ? iso(d.next_attempt_at) : null,
        delivered_at: d.delivered_at ? iso(d.delivered_at) : null,
      })),
      next_cursor: null,
    });
  });

  json.post('/api/w/{ws}/webhooks/{id}/deliveries/{delivery_id}/redeliver', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const ep = await one<{ id: string; workspace_slug: string }>(
      `SELECT id, workspace_slug FROM webhook_endpoints WHERE id = $1`, [req.params['id']]
    );
    if (!ep || ep.workspace_slug !== ws.slug) throw notFound();
    const d = await one<{ id: string; state: string; attempts: number }>(
      `SELECT id, state, attempts FROM webhook_deliveries WHERE id = $1 AND endpoint_id = $2`,
      [req.params['delivery_id'], ep.id]
    );
    if (!d) throw notFound();
    if (d.state !== 'dead') throw invalidTransition(d.state, 'pending');
    await query(`UPDATE webhook_deliveries SET state = 'pending', attempts = 0, next_attempt_at = now() WHERE id = $1`, [d.id]);
    const after = await one<{ event_id: string; event_type: string; sequence: string; state: string; attempts: number; last_status: number | null; last_error: string | null; next_attempt_at: Date | null; delivered_at: Date | null }>(
      `SELECT d.event_id, ev.type AS event_type, d.sequence::text AS sequence, d.state, d.attempts,
              d.last_status, d.last_error, d.next_attempt_at, d.delivered_at
       FROM webhook_deliveries d JOIN webhook_events ev ON ev.id = d.event_id WHERE d.id = $1`, [d.id]
    );
    sendJson(res, 202, {
      id: d.id, event_id: after!.event_id, event_type: after!.event_type, sequence: Number(after!.sequence),
      state: 'pending', attempts: 0, last_status: after!.last_status, last_error: after!.last_error,
      next_attempt_at: iso(new Date()), delivered_at: null,
    });
  });
}
