import { sendJson, type Router, type Req } from './http.js';
import { one, rows, tx } from './db.js';
import { fail, forbidden, invalidTransition, notFound, validationFailed } from './errors.js';
import { requireSession, loadSession } from './auth.js';
import { queueMail } from './mail.js';
import { wsCtx } from './api-ws.js';
import { sealWindows, markSealedQueued, billingSync } from './billing.js';
import { lifecycleSweep } from './lifecycle.js';
import { regionCameOnline } from './replication.js';
import { audit } from './audit.js';

function iso(d: Date): string { return d.toISOString(); }
function jsonBodyOf(req: { rawBody: Buffer | null }): Record<string, unknown> {
  if (!req.rawBody || req.rawBody.length === 0) return {};
  try { return JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}

// ---- Usage ----

export function registerUsageRoutes(json: Router): void {
  json.get('/api/w/{ws}/usage', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const plan = await one<{ id: string; name: string; included_storage_bytes: string; included_egress_bytes: string; storage_overage: string }>(
      `SELECT p.id, p.name, p.included_storage_bytes::text AS included_storage_bytes, p.included_egress_bytes::text AS included_egress_bytes, p.storage_overage
       FROM plans p JOIN workspaces w ON w.plan = p.id WHERE w.slug = $1`, [ws.slug]
    );
    const stored = await one<{ c: string }>(
      `SELECT COALESCE(SUM(stored_bytes),0)::text AS c FROM buckets WHERE workspace_slug = $1`, [ws.slug]
    );
    const reserved = await one<{ c: string }>(
      `SELECT COALESCE(SUM(bytes),0)::text AS c FROM quota_reservations WHERE workspace_slug = $1`, [ws.slug]
    );
    const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const period = periodStart.toISOString().slice(0, 7);
    const egress = await one<{ c: string }>(
      `SELECT COALESCE(SUM(amount::numeric),0)::text AS c FROM usage_rows
       WHERE workspace_slug = $1 AND unit = 'egress-gb' AND window_start >= $2`, [ws.slug, periodStart]
    );
    const units = await one<{ c: string }>(
      `SELECT COALESCE(SUM(amount::numeric),0)::text AS c FROM usage_rows
       WHERE workspace_slug = $1 AND unit = 'request-units' AND window_start >= $2`, [ws.slug, periodStart]
    );
    const storageHours = await one<{ c: string }>(
      `SELECT COALESCE(SUM(amount::numeric),0)::text AS c FROM usage_rows
       WHERE workspace_slug = $1 AND unit = 'storage-gb-hours' AND window_start >= $2`, [ws.slug, periodStart]
    );
    const unposted = await one<{ c: string }>(
      `SELECT count(*)::text AS c FROM usage_rows WHERE workspace_slug = $1 AND billing_state IN ('open','queued')`, [ws.slug]
    );
    const confirmed = await one<{ latest: Date | null }>(
      `SELECT MAX(window_end) AS latest FROM usage_rows WHERE workspace_slug = $1 AND billing_state = 'posted'`, [ws.slug]
    );
    const bs = await one<{ last_attempt_ok: boolean }>(`SELECT last_attempt_ok FROM billing_state WHERE id = 1`);
    const capped = plan!.storage_overage === 'none';
    const storedNum = Number(stored!.c);
    const egressBytes = Math.round(Number(egress!.c) * 1_000_000_000);
    const includedStorage = Number(plan!.included_storage_bytes);
    const includedEgress = Number(plan!.included_egress_bytes);
    const state = !bs?.last_attempt_ok ? 'delayed' : Number(unposted!.c) > 0 ? 'pending' : 'in_sync';
    sendJson(res, 200, {
      period,
      plan: { id: plan!.id, name: plan!.name, included_storage_bytes: includedStorage, included_egress_bytes: includedEgress },
      stored_bytes: storedNum,
      reserved_bytes: Number(reserved!.c),
      quota_bytes: capped ? includedStorage : null,
      egress_bytes: egressBytes,
      request_units: Number(units!.c),
      storage_gb_hours: Number(storageHours!.c).toString(),
      percent: {
        storage: Math.round(storedNum / includedStorage * 1000) / 10,
        egress: Math.round(egressBytes / includedEgress * 1000) / 10,
      },
      billing: {
        state,
        unposted_rows: Number(unposted!.c),
        confirmed_through: confirmed?.latest ? iso(confirmed.latest) : null,
      },
    });
  });

  json.get('/api/w/{ws}/usage/rows', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    const list = await rows<{ window_start: Date; window_end: Date; bucket_name: string; unit: string; amount: string; tracking_id: string; billing_state: string }>(
      `SELECT window_start, window_end, bucket_name, unit, amount, tracking_id, billing_state
       FROM usage_rows WHERE workspace_slug = $1 ORDER BY window_start DESC, bucket_name DESC, unit DESC LIMIT 50`,
      [ws.slug]
    );
    sendJson(res, 200, {
      rows: list.map(r => ({
        window_start: iso(r.window_start), window_end: iso(r.window_end), bucket: r.bucket_name,
        unit: r.unit, amount: r.amount, tracking_id: r.tracking_id, billing_state: r.billing_state,
      })),
      next_cursor: null,
    });
  });

  json.get('/api/w/{ws}/usage/export.csv', async (req, res) => {
    const auth = await requireSession(req);
    const { ws, role } = await wsCtx(req.params['ws'], auth);
    if (role !== 'owner') throw forbidden();
    let period = req.query.get('period') ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) throw validationFailed({ period: 'Pick a month as YYYY-MM.' });
    const [y, m] = period.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const list = await rows<{ window_start: Date; window_end: Date; bucket_name: string; unit: string; amount: string; tracking_id: string; billing_state: string }>(
      `SELECT window_start, window_end, bucket_name, unit, amount, tracking_id, billing_state
       FROM usage_rows WHERE workspace_slug = $1 AND window_start >= $2 AND window_start < $3
       ORDER BY window_start ASC, bucket_name ASC, unit ASC`, [ws.slug, start, end]
    );
    let out = 'window_start_utc,window_end_utc,bucket,unit,amount,tracking_id,billing_state\n';
    for (const r of list) {
      out += [r.window_start.toISOString().replace(/\.\d{3}Z$/, 'Z'), r.window_end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        r.bucket_name, r.unit, r.amount, r.tracking_id, r.billing_state].join(',') + '\n';
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="farshore-${ws.slug}-${period}.csv"`,
    });
    res.end(out);
  });
}

// ---- Operator ----

export function registerOpsRoutes(json: Router): void {
  const gate = async (req: Req): Promise<void> => {
    const { session, user } = await loadSession(req);
    if (!session || !user) throw fail(401, 'unauthenticated', 'Sign in to continue.');
    if (session.isPending) throw fail(401, 'two_step_required', 'Enter the code from your authenticator app to finish signing in.');
    if (!user.operator) throw forbidden('This area is for the Farshore operator.');
  };

  json.get('/api/ops/regions', async (req, res) => {
    await gate(req);
    const list = await rows<{ id: string; name: string; state: string }>(`SELECT id, name, state FROM regions ORDER BY id`);
    const out = [];
    for (const r of list) {
      const counts = await one<{ pending: string; failed: string; oldest: number | null }>(
        `SELECT count(*) FILTER (WHERE rp.state = 'pending')::text AS pending,
                count(*) FILTER (WHERE rp.state = 'failed')::text AS failed,
                MIN(CASE WHEN rp.state = 'pending' THEN EXTRACT(EPOCH FROM (now() - v.acknowledged_at)) * 1000 END) AS oldest
         FROM replicas rp JOIN versions v ON v.version_id = rp.version_id
         WHERE rp.region = $1 AND v.state = 'current'`, [r.id]
      );
      out.push({
        id: r.id, name: r.name, state: r.state,
        pending: Number(counts!.pending), failed: Number(counts!.failed),
        oldest_pending_ms: counts!.oldest !== null ? Math.round(Number(counts!.oldest)) : null,
      });
    }
    sendJson(res, 200, { regions: out });
  });

  json.post('/api/ops/regions/{id}/state', async (req, res) => {
    await gate(req);
    const body = jsonBodyOf(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'state') errors[k] = "This field can't be set.";
    if (!('state' in body)) errors.state = 'This field is required.';
    if (body.state !== 'online' && body.state !== 'offline') errors.state = 'Choose online or offline.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const region = await one<{ id: string; name: string; state: string }>(`SELECT id, name, state FROM regions WHERE id = $1`, [req.params['id']]);
    if (!region) throw notFound();
    const updated = await tx(async client => {
      const r = await client.query(
        `UPDATE regions SET state = $1 WHERE id = $2 AND state <> $1 RETURNING id, name, state`,
        [body.state, region.id]
      );
      return r.rows[0] ?? null;
    });
    if (!updated) throw invalidTransition(region.state, String(body.state));
    if (body.state === 'online') await regionCameOnline(region.id);
    sendJson(res, 200, { id: updated.id, name: updated.name, state: updated.state });
  });

  json.get('/api/ops/workspaces', async (req, res) => {
    await gate(req);
    const list = await rows<{ slug: string; name: string; plan: string; status: string; suspended_reason: string | null }>(
      `SELECT w.slug, w.name, p.name AS plan, w.status, w.suspended_reason
       FROM workspaces w JOIN plans p ON p.id = w.plan ORDER BY w.name`
    );
    const out = [];
    for (const w of list) {
      const members = await one<{ c: string }>(`SELECT count(*)::text AS c FROM members WHERE workspace_slug = $1`, [w.slug]);
      const buckets = await one<{ c: string }>(`SELECT count(*)::text AS c FROM buckets WHERE workspace_slug = $1`, [w.slug]);
      out.push({
        slug: w.slug, name: w.name, plan: w.plan, members: Number(members!.c),
        buckets: Number(buckets!.c), status: w.status, suspended_reason: w.suspended_reason,
      });
    }
    sendJson(res, 200, { workspaces: out });
  });

  json.post('/api/ops/workspaces/{ws}/suspend', async (req, res) => {
    await gate(req);
    const body = jsonBodyOf(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'reason') errors[k] = "This field can't be set.";
    if (!('reason' in body)) errors.reason = 'This field is required.';
    const reason = String(body.reason ?? '');
    if (reason.length < 1 || reason.length > 280) errors.reason = 'Reasons are 1 to 280 characters.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const w = await one<{ slug: string; name: string; status: string }>(`SELECT slug, name, status FROM workspaces WHERE slug = $1`, [req.params['ws']]);
    if (!w) throw notFound();
    const updated = await tx(async client => {
      const r = await client.query(
        `UPDATE workspaces SET status = 'suspended', suspended_reason = $1, suspended_at = now()
         WHERE slug = $2 AND status = 'active' RETURNING slug`, [reason, w.slug]
      );
      return r.rowCount ?? 0;
    });
    if (updated === 0) throw invalidTransition('suspended', 'suspended');
    await audit(w.slug, 'operator', 'workspace.suspended', w.slug, reason);
    const owners = await rows<{ email: string }>(
      `SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_slug = $1 AND m.role = 'owner'`, [w.slug]
    );
    for (const o of owners) {
      await queueMail(o.email, `${w.name} is suspended on Farshore`, `Your workspace ${w.name} was suspended.\n\nReason: ${reason}\n`);
    }
    sendJson(res, 200, { slug: w.slug, name: w.name, status: 'suspended', suspended_reason: reason });
  });

  json.post('/api/ops/workspaces/{ws}/reinstate', async (req, res) => {
    await gate(req);
    const w = await one<{ slug: string; name: string; status: string }>(`SELECT slug, name, status FROM workspaces WHERE slug = $1`, [req.params['ws']]);
    if (!w) throw notFound();
    const updated = await tx(async client => {
      const r = await client.query(
        `UPDATE workspaces SET status = 'active', suspended_reason = NULL, suspended_at = NULL
         WHERE slug = $1 AND status = 'suspended' RETURNING slug`, [w.slug]
      );
      return r.rowCount ?? 0;
    });
    if (updated === 0) throw invalidTransition('active', 'active');
    await audit(w.slug, 'operator', 'workspace.reinstated', w.slug, '');
    sendJson(res, 200, { slug: w.slug, name: w.name, status: 'active', suspended_reason: null });
  });

  json.post('/api/ops/lifecycle/run', async (req, res) => {
    await gate(req);
    const r = await lifecycleSweep();
    sendJson(res, 200, r);
  });

  json.get('/api/ops/billing', async (req, res) => {
    await gate(req);
    const queued = await one<{ c: string }>(`SELECT count(*)::text AS c FROM usage_rows WHERE billing_state = 'queued'`);
    const posted = await one<{ c: string }>(`SELECT count(*)::text AS c FROM usage_rows WHERE billing_state = 'posted'`);
    const bs = await one<{ last_attempt_at: Date | null; last_error: string | null; last_attempt_ok: boolean }>(
      `SELECT last_attempt_at, last_error, last_attempt_ok FROM billing_state WHERE id = 1`
    );
    const unpostedOpen = await one<{ c: string }>(`SELECT count(*)::text AS c FROM usage_rows WHERE billing_state = 'open'`);
    const state = !bs?.last_attempt_ok ? 'delayed'
      : Number(queued!.c) > 0 || Number(unpostedOpen!.c) > 0 ? 'pending' : 'in_sync';
    sendJson(res, 200, {
      state,
      queued_rows: Number(queued!.c),
      posted_rows: Number(posted!.c),
      last_attempt_at: bs?.last_attempt_at ? iso(bs.last_attempt_at) : null,
      last_error: bs?.last_error ?? null,
    });
  });

  json.post('/api/ops/billing/sync', async (req, res) => {
    await gate(req);
    await sealWindows(true);
    await markSealedQueued();
    const r = await billingSync();
    if (r.queued > 0) {
      sendJson(res, 202, { sealed: r.posted, posted: r.posted, queued: r.queued, state: r.state });
    } else {
      sendJson(res, 200, { sealed: r.posted, posted: r.posted, queued: 0, state: r.state });
    }
  });
}
