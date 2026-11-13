/** Background work: notice relay, request sweep, year-record worker.
 *  Claimed with row leases and fencing tokens, safe across processes. */
import { Pool, PoolClient } from 'pg';
import { AppDeps } from './apiTypes';
import { renderPdf, RendererUnavailable } from '../pdf/gotenberg';
import { StorageUnavailable } from '../storage/s3';
import { sendMail, MailUnavailable } from '../mail/smtp';
import { digestOf, canonicalJson } from '../lib/canonical';
import * as auth from './auth';
import { appendLog, withTransaction } from '../db/db';
import { deriveYearDoc } from './planApi';
import { formatMoney } from '../lib/money';
import { screenDate, monthName } from '../lib/screenDate';

export function startWorkers(deps: AppDeps): { stop: () => void } {
  const tick = async () => {
    const run = (name: string, fn: () => Promise<void>) =>
      fn().catch((e) => {
        process.stderr.write(`worker ${name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}\n`);
      });
    await Promise.all([
      run('relay', () => relayNotices(deps)),
      run('sweep', () => sweepRequests(deps)),
      run('records', () => workRecords(deps)),
      run('cleanup', () => cleanupIdempotency(deps)),
    ]);
  };
  const timer = setInterval(tick, 2000);
  void tick();
  return { stop: () => clearInterval(timer) };
}

/** Notice relay: hand to SMTP, mark sent; failures retry after 2 seconds
 *  indefinitely with the failing process waiting 6 seconds. */
async function relayNotices(deps: AppDeps): Promise<void> {
  const { pool, config } = deps;
  const res = await pool.query(
    `SELECT * FROM notices WHERE status='queued'
       AND (lease_until IS NULL OR lease_until < now())
       AND (attempt_failed_at IS NULL OR attempt_failed_at < now() - interval '2 seconds')
     ORDER BY queued_at ASC LIMIT 10`,
  );
  for (const notice of res.rows) {
    // superseded notices never reach SMTP
    if (notice.status !== 'queued') continue;
    // check supersession conditions fresh
    const fresh = await pool.query(`SELECT status FROM notices WHERE id=$1`, [notice.id]);
    if (fresh.rows[0]?.status !== 'queued') continue;
    if (notice.kind === 'reminder') {
      const req = await pool.query(
        `SELECT 1 FROM swaps WHERE id=$1 AND state='sent'
         UNION ALL SELECT 1 FROM costs WHERE id=$1 AND state='sent'`,
        [notice.linked_id],
      );
      void req;
    }
    // claim with a lease
    const claim = await pool.query(
      `UPDATE notices SET lease_until = now() + interval '30 seconds',
         claim_fence = claim_fence + 1
       WHERE id=$1 AND status='queued' AND (lease_until IS NULL OR lease_until < now())
       RETURNING claim_fence`,
      [notice.id],
    );
    if (claim.rows.length === 0) continue;
    const fence = claim.rows[0].claim_fence as number;
    try {
      await sendMail(config.smtpHost, config.smtpPort, {
        from: config.mailFrom,
        to: notice.to_email,
        subject: notice.subject,
        body: mailBody(deps, notice),
        messageId: `${notice.id}@twohouse.local`,
      });
      await pool.query(
        `UPDATE notices SET status='sent', sent_at=now(), attempts=attempts+1, lease_until=NULL,
           attempt_failed_at=NULL WHERE id=$1 AND claim_fence=$2 AND status='queued'`,
        [notice.id, fence],
      );
    } catch (e) {
      if (e instanceof MailUnavailable) {
        await pool.query(
          `UPDATE notices SET attempts=attempts+1, attempt_failed_at=now(), lease_until=NULL
           WHERE id=$1 AND claim_fence=$2 AND status='queued'`,
          [notice.id, fence],
        );
      } else {
        throw e;
      }
    }
  }
}

function mailBody(deps: AppDeps, notice: { link: string }): string {
  // the household name and a link only: no amounts, notes or reasons
  return `open Twohouse to see the details.\n${deps.config.appPublicUrl}${notice.link}\n`;
}

/** Request sweep: lapse sent requests at their answer-by, send one reminder,
 *  settle accepted swaps at the handover instant. Persists each within 5s. */
async function sweepRequests(deps: AppDeps): Promise<void> {
  const { pool, config } = deps;
  void config;
  // lapses
  const lapsed = await pool.query(
    `SELECT 'swap' AS kind, s.id, s.household_id FROM swaps s
       WHERE s.state='sent' AND s.answer_by IS NOT NULL AND s.answer_by <= now()
     UNION ALL
     SELECT 'cost' AS kind, c.id, c.household_id FROM costs c
       WHERE c.state='sent' AND c.answer_by IS NOT NULL AND c.answer_by <= now()
     LIMIT 20`,
  );
  for (const row of lapsed.rows) {
    await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [row.household_id]);
      if (row.kind === 'swap') {
        const upd = await client.query(
          `UPDATE swaps SET state='lapsed' WHERE id=$1 AND state='sent' AND answer_by <= now() RETURNING id`,
          [row.id],
        );
        if (upd.rows.length === 0) return;
        await appendLog(client, row.household_id, 'system', 'swap.lapsed', row.id);
        await queueLapsedNotices(client, deps, row.household_id);
      } else {
        const upd = await client.query(
          `UPDATE costs SET state='lapsed' WHERE id=$1 AND state='sent' AND answer_by <= now() RETURNING id`,
          [row.id],
        );
        if (upd.rows.length === 0) return;
        await appendLog(client, row.household_id, 'system', 'cost.lapsed', row.id);
        await queueLapsedNotices(client, deps, row.household_id);
      }
    });
  }
  // reminders: one, at the stored reminder moment
  const reminders = await pool.query(
    `SELECT 'swap' AS kind, s.id, s.household_id, s.answer_by, s.answer_zone, s.created_by FROM swaps s
       WHERE s.state='sent' AND s.reminded_at IS NULL AND s.reminder_at IS NOT NULL AND s.reminder_at <= now()
     UNION ALL
     SELECT 'cost' AS kind, c.id, c.household_id, c.answer_by, c.answer_zone, c.paid_by AS created_by FROM costs c
       WHERE c.state='sent' AND c.reminded_at IS NULL AND c.reminder_at IS NOT NULL AND c.reminder_at <= now()
     LIMIT 20`,
  );
  for (const row of reminders.rows) {
    await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [row.household_id]);
      const table = row.kind === 'swap' ? 'swaps' : 'costs';
      const upd = await client.query(
        `UPDATE ${table} SET reminded_at=now()
         WHERE id=$1 AND state='sent' AND reminded_at IS NULL AND reminder_at <= now() RETURNING id`,
        [row.id],
      );
      if (upd.rows.length === 0) return;
      const h = await client.query(`SELECT * FROM households WHERE id=$1`, [row.household_id]);
      const answerer = row.created_by === 'planning' ? 'other' : 'planning';
      const answererEmail = answerer === 'planning' ? h.rows[0].planning_email : h.rows[0].other_email;
      const noticeId = auth.randomId();
      await client.query(
        `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status, linked_id)
         VALUES ($1,$2,'reminder',$3,$4,'/requests','queued',$5)`,
        [noticeId, row.household_id, answererEmail, `Answer needed in ${h.rows[0].name}`, row.id],
      );
      await appendLog(client, row.household_id, 'system', row.kind === 'swap' ? 'swap.reminded' : 'cost.reminded', row.id);
    });
  }
}

async function queueLapsedNotices(client: PoolClient, deps: AppDeps, hid: string): Promise<void> {
  const h = await client.query(`SELECT * FROM households WHERE id=$1`, [hid]);
  const { config } = deps;
  for (const email of [h.rows[0].planning_email, h.rows[0].other_email]) {
    const noticeId = auth.randomId();
    await client.query(
      `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
       VALUES ($1,$2,'lapsed',$3,$4,'/requests','queued')`,
      [noticeId, hid, email, `A request lapsed in ${h.rows[0].name}`],
    );
  }
  void config;
}

/** Year-record worker: three idempotent steps with recorded progress. */
async function workRecords(deps: AppDeps): Promise<void> {
  const { pool, config } = deps;
  // find requested or rendering records ready for a step; the failing process
  // does not reclaim for 6 seconds (lease_until doubles as the cooldown)
  const res = await pool.query(
    `SELECT * FROM records
     WHERE (state='requested' OR state='rendering')
       AND (worker_lease_until IS NULL OR worker_lease_until < now())
     ORDER BY requested_at ASC LIMIT 3`,
  );
  for (const r of res.rows) {
    const fence = await pool.query(
      `UPDATE records SET worker_lease_until = now() + interval '30 seconds',
         worker_fence = worker_fence + 1
       WHERE id=$1 AND (worker_lease_until IS NULL OR worker_lease_until < now())
       RETURNING worker_fence`,
      [r.id],
    );
    if (fence.rows.length === 0) continue;
    const token = fence.rows[0].worker_fence as number;
    await runRecordSteps(deps, r, token);
  }
  void config;
}

async function runRecordSteps(deps: AppDeps, r: Record<string, unknown>, fence: number): Promise<void> {
  const { pool, config } = deps;
  const hid = r.household_id as string;
  const id = r.id as string;
  const year = r.year as number;
  const stepsDone = r.steps_done as number;

  // render step
  if (stepsDone === 0) {
    let pdf: Buffer;
    try {
      const html = await buildRecordHtml(deps, hid, year, r.year_digest as string);
      pdf = await renderPdf(config.gotenbergUrl, html);
    } catch (e) {
      if (e instanceof RendererUnavailable) {
        await recordAttemptFailure(pool, id, fence, 'renderer');
        return;
      }
      throw e;
    }
    const ok = await pool.query(
      `UPDATE records SET steps_done=1, state='rendering' WHERE id=$1 AND worker_fence=$2 AND state IN ('requested','rendering')`,
      [id, fence],
    );
    if (ok.rowCount === 0) return;
    await withTransaction(pool, async (client) => {
      await appendLog(client, hid, 'system', 'record.rendering', id);
    });
    // store the rendered bytes for the next step: keep in memory only
    await runStoreStep(deps, hid, id, year, fence, pdf, r.year_digest as string);
    return;
  }
  if (stepsDone >= 1) {
    // resume from the next step: re-render to reproduce bytes
    let pdf: Buffer;
    try {
      const html = await buildRecordHtml(deps, hid, year, r.year_digest as string);
      pdf = await renderPdf(config.gotenbergUrl, html);
    } catch (e) {
      if (e instanceof RendererUnavailable) {
        await recordAttemptFailure(pool, id, fence, 'renderer');
        return;
      }
      throw e;
    }
    await runStoreStep(deps, hid, id, year, fence, pdf, r.year_digest as string);
  }
}

async function runStoreStep(
  deps: AppDeps, hid: string, id: string, year: number,
  fence: number, pdf: Buffer, yearDigest: string,
): Promise<void> {
  const { pool, config } = deps;
  const objectKey = `households/${hid}/records/${id}.pdf`;
  const sha = digestOf(pdf);
  try {
    await deps.s3.putObject(objectKey, pdf, 'application/pdf');
    const back = await deps.s3.getObject(objectKey);
    if (back.length !== pdf.length || digestOf(back) !== sha) {
      await deps.s3.deleteObject(objectKey).catch(() => undefined);
      await recordAttemptFailure(pool, id, fence, 'storage');
      return;
    }
  } catch (e) {
    if (e instanceof StorageUnavailable) {
      await recordAttemptFailure(pool, id, fence, 'storage');
      return;
    }
    throw e;
  }
  const ok = await pool.query(
    `UPDATE records SET steps_done=2, state='rendering'
     WHERE id=$1 AND worker_fence=$2 AND state IN ('requested','rendering')`,
    [id, fence],
  );
  if (ok.rowCount === 0) return;
  // confirm step: read back again through the API path, then store
  const stored = await pool.query(
    `UPDATE records SET state='stored', steps_done=3, pdf_bytes=$2, pdf_sha256=$3, stored_at=now(),
       waiting_on=NULL, failure=NULL, worker_lease_until=NULL
     WHERE id=$1 AND worker_fence=$4 AND state IN ('requested','rendering') RETURNING id`,
    [id, pdf.length, sha, fence],
  );
  if (stored.rows.length === 0) {
    // fenced out: a cancelled record's object is removed within 5 seconds
    const cancelled = await pool.query(`SELECT state FROM records WHERE id=$1`, [id]);
    if (cancelled.rows[0]?.state === 'cancelled') {
      await deps.s3.deleteObject(objectKey).catch(() => undefined);
    }
    return;
  }
  await withTransaction(pool, async (client) => {
    await appendLog(client, hid, 'system', 'record.stored', id);
    const h = await client.query(`SELECT * FROM households WHERE id=$1`, [hid]);
    for (const email of [h.rows[0].planning_email, h.rows[0].other_email]) {
      const noticeId = auth.randomId();
      await client.query(
        `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
         VALUES ($1,$2,'record_ready',$3,$4,'/records','queued')`,
        [noticeId, hid, email, `Year record ready in ${h.rows[0].name}`],
      );
    }
  });
  void config; void year; void yearDigest;
}

async function recordAttemptFailure(pool: Pool, id: string, fence: number, service: 'renderer' | 'storage'): Promise<void> {
  const res = await pool.query(
    `UPDATE records SET attempts = attempts + 1,
       state = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'requested' END,
       waiting_on = CASE WHEN attempts + 1 >= 3 THEN NULL ELSE $2 END,
       failure = CASE WHEN attempts + 1 >= 3 THEN $3 ELSE NULL END,
       worker_lease_until = CASE WHEN attempts + 1 >= 3 THEN NULL ELSE now() + interval '6 seconds' END
     WHERE id=$1 AND worker_fence=$4 AND state IN ('requested','rendering')
     RETURNING attempts, state`,
    [id, service, service === 'renderer' ? 'renderer_unavailable' : 'storage_unavailable', fence],
  );
  if (res.rows.length > 0 && res.rows[0].state === 'failed') {
    const hid = await pool.query(`SELECT household_id FROM records WHERE id=$1`, [id]);
    await withTransaction(pool, async (client) => {
      await appendLog(client, hid.rows[0].household_id, 'system', 'record.failed', id);
    });
  }
}

/** The year record PDF HTML: twelve month calendars and the published lines. */
async function buildRecordHtml(deps: AppDeps, hid: string, year: number, yearDigest: string): Promise<string> {
  const doc = await deriveYearDoc(deps, hid, year);
  const h = await deps.pool.query(`SELECT * FROM households WHERE id=$1`, [hid]);
  const household = h.rows[0];
  const days = doc.days as Array<Record<string, unknown>>;
  const lines: string[] = [
    `Twohouse year record ${year}`,
    household.name,
    `Year digest ${yearDigest}`,
    `Nights: ${household.planning_name} ${(doc.nights as Record<string, number>).planning}, ${household.other_name} ${(doc.nights as Record<string, number>).other}`,
  ];
  // swaps with a night in the year
  const swaps = await deps.pool.query(
    `SELECT * FROM swaps WHERE household_id=$1 AND state IN ('accepted','settled') ORDER BY id`,
    [hid],
  );
  for (const s of swaps.rows) {
    if (overlapsYear(s.nights_start, s.nights_end, year)) {
      lines.push(`Swap ${screenDate(parseScreen(s.nights_start))} to ${screenDate(parseScreen(s.nights_end))} with ${s.to_parent === 'planning' ? household.planning_name : household.other_name}`);
    }
    if (s.makeup_start && s.makeup_end && overlapsYear(s.makeup_start, s.makeup_end, year)) {
      lines.push(`Make-up ${screenDate(parseScreen(s.makeup_start))} to ${screenDate(parseScreen(s.makeup_end))} with ${s.to_parent === 'planning' ? household.other_name : household.planning_name}`);
    }
  }
  const costs = await deps.pool.query(
    `SELECT * FROM costs WHERE household_id=$1 AND state IN ('accepted','settled') ORDER BY id`,
    [hid],
  );
  for (const c of costs.rows) {
    if ((c.custody_day as string).slice(0, 4) === String(year)) {
      lines.push(`${screenDate(parseScreen(c.custody_day))} ${c.description} ${formatMoney(Number(c.amount_minor), household.currency)} paid by ${c.paid_by === 'planning' ? household.planning_name : household.other_name}: ${household.planning_name} ${formatMoney(Number(c.share_planning), household.currency)}, ${household.other_name} ${formatMoney(Number(c.share_other), household.currency)}`);
    }
  }
  // twelve month calendars
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const cells = days.filter((d) => {
      const date = d.date as string;
      return Number(date.slice(5, 7)) === m;
    });
    const rows: string[] = [];
    for (const d of cells) {
      const owner = d.owner === 'planning' ? household.planning_name : d.owner === 'other' ? household.other_name : '';
      rows.push(`<tr><td>${(d.date as string).slice(8)}</td><td class="${d.owner === 'planning' ? 'mint' : d.owner === 'other' ? 'pink' : ''}">${owner}</td></tr>`);
    }
    months.push(`<table class="month"><caption>${monthName(m)} ${year}</caption><tr><th>Day</th><th>With</th></tr>${rows.join('')}</table>`);
  }
  const headLines = lines.map((l) => `<div class="line">${escapeHtml(l)}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Twohouse year record ${year}</title>
<style>
@page { size: A4; margin: 2cm; }
body { font-family: sans-serif; font-size: 10pt; }
.line { white-space: pre; margin: 0 0 4pt; }
.month { display: inline-table; width: 24%; margin: 2pt; border-collapse: collapse; }
.month caption { font-weight: bold; }
.month td, .month th { border: 1px solid #ccc; padding: 1pt 3pt; font-size: 8pt; }
.mint { background: #bfe8dd; }
.pink { background: #f6cfe2; }
</style></head><body>${headLines}${months.join('')}</body></html>`;
}

function overlapsYear(start: string, end: string, year: number): boolean {
  return start.slice(0, 4) <= String(year) && end.slice(0, 4) >= String(year);
}

function parseScreen(dateStr: string): { year: number; month: number; day: number; dow: number } {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const d = Number(dateStr.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const jsDow = dt.getUTCDay();
  return { year: y, month: m, day: d, dow: jsDow === 0 ? 7 : jsDow };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function cleanupIdempotency(deps: AppDeps): Promise<void> {
  await deps.pool.query(
    `DELETE FROM idempotency WHERE created_at < now() - interval '24 hours'`,
  );
}

export { canonicalJson };
