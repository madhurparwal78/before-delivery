import { one, rows, query } from './db.js';
import { config } from './config.js';
import { postUsageRow, ensureWorkspaceBilling } from './killbill.js';
import { runMailWorker } from './mail.js';

/** Seals windows that have ended and computes exact storage integrals. */
export async function sealWindows(manual = false): Promise<void> {
  const buckets = await rows<{ name: string; workspace_slug: string; stored_bytes: string }>(
    `SELECT b.name, b.workspace_slug, b.stored_bytes::text AS stored_bytes FROM buckets b
     JOIN workspaces w ON w.slug = b.workspace_slug WHERE w.status = 'active'`
  );
  const now = new Date();
  const hourStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  for (const b of buckets) {
    // Find every window since the bucket's last storage row that has ended.
    const last = await one<{ window_start: Date }>(
      `SELECT window_start FROM usage_rows WHERE bucket_name = $1 AND unit = 'storage-gb-hours' ORDER BY window_start DESC LIMIT 1`,
      [b.name]
    );
    const created = await one<{ created_at: Date }>(`SELECT created_at FROM buckets WHERE name = $1`, [b.name]);
    if (!created) continue;
    let cursor = last ? last.window_start : new Date(Math.floor(created.created_at.getTime() / 3_600_000) * 3_600_000);
    while (cursor < hourStart || (manual && cursor <= hourStart)) {
      const end = new Date(cursor.getTime() + 3_600_000);
      const boundedEnd = manual && end > now ? now : end;
      if (boundedEnd <= cursor) break;
      await sealWindow(b.name, b.workspace_slug, cursor, boundedEnd, manual);
      cursor = end;
    }
  }
}

async function sealWindow(bucket: string, ws: string, start: Date, end: Date, manual: boolean): Promise<void> {
  // Exact byte-second integral over [start, end).
  const events = await rows<{ at: Date; stored_bytes: string }>(
    `SELECT at, stored_bytes::text AS stored_bytes FROM storage_events
     WHERE bucket_name = $1 AND at < $2 ORDER BY at ASC`, [bucket, end]
  );
  let integral = 0n;
  let prevTime = start.getTime();
  let prevBytes: bigint | null = null;
  for (const ev of events) {
    const bytes = BigInt(ev.stored_bytes);
    const at = Math.max(ev.at.getTime(), start.getTime());
    if (prevBytes !== null) integral += prevBytes * BigInt(Math.max(0, at - prevTime));
    if (at >= start.getTime()) prevBytes = bytes;
    prevTime = at;
  }
  if (prevBytes !== null) integral += prevBytes * BigInt(Math.max(0, end.getTime() - prevTime));
  if (integral === 0n) return;
  // Divide by 3.6e12, round half up to 9 dp.
  const denom = 3_600_000_000_000n;
  const scaled = integral * 10n ** 9n;
  const q = (scaled + denom / 2n) / denom;
  const amount = decimalString(q, 9);
  if (amount === '0') return;
  const tracking = `fs-${ws}-${bucket}-storage-gb-hours-${start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
  await query(
    `INSERT INTO usage_rows (workspace_slug, bucket_name, unit, window_start, window_end, amount, tracking_id, billing_state)
     VALUES ($1,$2,'storage-gb-hours',$3,$4,$5,$6,'open')
     ON CONFLICT (workspace_slug, bucket_name, unit, window_start) DO NOTHING`,
    [ws, bucket, start, manual ? end : end, amount, tracking]
  );
}

function decimalString(scaled: bigint, dp: number): string {
  const neg = scaled < 0n;
  let s = (neg ? -scaled : scaled).toString().padStart(dp + 1, '0');
  const int = s.slice(0, -dp);
  let frac = s.slice(-dp);
  frac = frac.replace(/0+$/, '');
  const body = frac.length > 0 ? `${int}.${frac}` : int;
  return (neg ? '-' : '') + body;
}

/** Posts every queued row. Returns posted and remaining counts. */
export async function billingSync(): Promise<{ posted: number; queued: number; state: string }> {
  const now = new Date();
  const queued = await rows<{
    workspace_slug: string; bucket_name: string; unit: string; window_start: Date; amount: string; tracking_id: string;
  }>(`SELECT workspace_slug, bucket_name, unit, window_start, amount, tracking_id
      FROM usage_rows WHERE billing_state = 'queued' ORDER BY window_start ASC, bucket_name ASC, unit ASC`);
  let posted = 0;
  let lastOk = true;
  let lastError: string | null = null;
  for (const r of queued) {
    const ok = await postUsageRow(r);
    if (ok) {
      await query(`UPDATE usage_rows SET billing_state = 'posted' WHERE tracking_id = $1`, [r.tracking_id]);
      posted++;
    } else {
      lastOk = false;
      lastError = 'killbill_unreachable';
      break;
    }
  }
  await query(
    `INSERT INTO billing_state (id, last_attempt_at, last_error, last_attempt_ok) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET last_attempt_at = $1, last_error = $2, last_attempt_ok = $3`,
    [now, lastError, lastOk]
  );
  const remaining = await rows<{ c: string }>(`SELECT count(*)::text AS c FROM usage_rows WHERE billing_state = 'queued'`);
  const queuedCount = Number(remaining[0].c);
  const state = !lastOk ? 'delayed' : queuedCount > 0 ? 'pending' : 'in_sync';
  return { posted, queued: queuedCount, state };
}

/** Marks sealed rows as queued: they are ready for posting. */
export async function markSealedQueued(): Promise<void> {
  await query(`UPDATE usage_rows SET billing_state = 'queued' WHERE billing_state = 'open' AND window_end <= now()`);
}

/** Ensures every workspace has a Kill Bill account and subscription. */
async function ensureAllWorkspacesBilling(): Promise<void> {
  const list = await rows<{ slug: string; name: string; plan: string }>(
    `SELECT w.slug, w.name, p.id AS plan FROM workspaces w JOIN plans p ON p.id = w.plan ORDER BY w.slug`
  );
  for (const ws of list) {
    await ensureWorkspaceBilling({ slug: ws.slug, name: ws.name, plan: ws.plan });
  }
}

/** The billing loop: seal windows, ensure accounts, and post queued rows. */
export async function startBillingLoop(): Promise<void> {
  for (;;) {
    await new Promise(r => setTimeout(r, config.timing.billingSync * 1000));
    try {
      await ensureAllWorkspacesBilling();
      await markSealedQueued();
      await billingSync();
    } catch { /* retried next tick */ }
  }
}

/** The mail loop. */
export async function startMailLoop(): Promise<void> {
  for (;;) {
    await new Promise(r => setTimeout(r, 30_000));
    try { await runMailWorker(); } catch { /* retried next tick */ }
  }
}

export { decimalString };
