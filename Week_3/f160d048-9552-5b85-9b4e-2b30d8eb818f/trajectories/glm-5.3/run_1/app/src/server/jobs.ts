// Due jobs: claim lapses, alert batches, outbox sends and search sync.
import crypto from 'node:crypto';
import type { App } from '../lib/app.js';
import { config } from '../lib/config.js';
import { nowMs } from '../lib/clock.js';
import { sendMail, smtpAvailable } from '../lib/mail.js';
import { cityName, rangeText, WORK_PATTERNS, ROLE_FAMILIES } from '../lib/reference.js';
import { meili } from '../lib/meili.js';
import { jobDoc, companyDoc } from './search.js';

let running = false;

export async function runDueJobs(app: App): Promise<void> {
  if (running) return;
  running = true;
  try {
    await lapseClaims(app);
    await sendOutbox(app);
    await retrySearchSync(app);
    await alertBatches(app);
  } catch (err) {
    console.error('due jobs failed', err);
  } finally {
    running = false;
  }
}

export function startJobLoop(app: App): void {
  const tick = async () => {
    await runDueJobs(app);
    setTimeout(tick, 5000).unref();
  };
  void tick();
}

// A claim lease that has ended returns the post to pending.
async function lapseClaims(app: App): Promise<void> {
  const due = await app.db.many<{ id: string; claimed_by: string }>(
    `select id, claimed_by from posts
     where state = 'claimed' and lease_ends_at is not null and lease_ends_at <= $1`,
    [new Date(nowMs())],
  );
  for (const row of due) {
    await app.db.withClient(async (client) => {
      await client.query('begin');
      try {
        const fresh = await client.query<{ id: string }>(
          'select id from posts where id = $1 and state = $2 and lease_ends_at <= $3 for update',
          [row.id, 'claimed', new Date(nowMs())],
        );
        if (fresh.rows.length === 0) {
          await client.query('rollback');
          return;
        }
        await client.query(
          `update posts set state = 'pending', last_claimant = claimed_by, claimed_by = null, claimed_at = null, lease_ends_at = null where id = $1`,
          [row.id],
        );
        await client.query(`insert into post_history (post_id, type, by_name) values ($1, 'expired', null)`, [row.id]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });
    app.live.publish({ type: 'queue.changed', data: { post_id: row.id, state: 'pending', by_name: null } });
    app.live.publish({
      type: 'queue.history',
      data: { post_id: row.id, event: { type: 'expired', by_name: null, reason: null, at: new Date().toISOString() } },
    });
  }
}

// An outbox row is claimed and sent exactly once.
async function sendOutbox(app: App): Promise<void> {
  if (!(await smtpAvailable())) return;
  const rows = await app.db.many<{ id: number; to_email: string; subject: string; body: string }>(
    `select id, to_email, subject, body from outbox
     where status = 'pending' and next_attempt_at <= $1
     order by id asc limit 20`,
    [new Date(nowMs())],
  );
  for (const row of rows) {
    const claimed = await app.db.query(
      `update outbox set status = 'sending', attempts = attempts + 1
       where id = $1 and status = 'pending' returning id`,
      [row.id],
    );
    if ((claimed.rowCount ?? 0) === 0) continue;
    try {
      await sendMail({ to: row.to_email, subject: row.subject, body: row.body });
      await app.db.query(`update outbox set status = 'sent', sent_at = now() where id = $1`, [row.id]);
    } catch {
      await app.db.query(
        `update outbox set status = 'pending', next_attempt_at = $2 where id = $1`,
        [row.id, new Date(nowMs() + config().outboxRetrySeconds * 1000)],
      );
    }
  }
}

async function retrySearchSync(app: App): Promise<void> {
  const rows = await app.db.many<{ id: string; kind: string; record_id: string; action: string }>(
    'select id, kind, record_id, action from search_sync where next_attempt_at <= $1 order by created_at asc limit 20',
    [new Date(nowMs())],
  );
  for (const row of rows) {
    try {
      if (row.kind === 'job') {
        if (row.action === 'delete') {
          const task = await meili.deleteDocument('jobs', row.record_id);
          await meili.waitForTask(task);
        } else {
          const job = await app.db.one<{ status: string }>('select status from jobs where id = $1', [row.record_id]);
          if (job?.status === 'listed') {
            const doc = await jobDoc(app, row.record_id);
            if (doc) {
              const task = await meili.updateDocuments('jobs', [doc as unknown as Record<string, unknown>]);
              await meili.waitForTask(task);
            }
          }
        }
      } else {
        const doc = await companyDoc(app, row.record_id);
        if (doc) {
          const task = await meili.updateDocuments('companies', [doc]);
          await meili.waitForTask(task);
        }
      }
      await app.db.query('delete from search_sync where id = $1', [row.id]);
    } catch {
      await app.db.query('update search_sync set attempts = attempts + 1, next_attempt_at = $2 where id = $1', [
        row.id,
        new Date(nowMs() + config().outboxRetrySeconds * 1000),
      ]);
    }
  }
}

// One batched email per alert after ALERT_BATCH_SECONDS.
async function alertBatches(app: App): Promise<void> {
  const due = await app.db.many<{
    id: string;
    alert_id: string;
    user_id: string;
    q: string;
    cities: string[];
    roles: string[];
    remotes: string[];
    bands: string[];
    job_ids: string[];
    first_matched_at: Date;
  }>(
    `select b.id, b.alert_id, b.job_ids, b.first_matched_at, a.user_id, a.q, a.cities, a.roles, a.remotes, a.bands
     from alert_batches b join alerts a on a.id = b.alert_id
     where b.sent_at is null and b.due_at <= $1`,
    [new Date(nowMs())],
  );
  for (const batch of due) {
    const claimed = await app.db.query(
      `update alert_batches set sent_at = now() where id = $1 and sent_at is null returning id`,
      [batch.id],
    );
    if ((claimed.rowCount ?? 0) === 0) continue;
    const jobs: {
      id: string;
      title: string;
      company_name: string;
      city: string;
      pay_low: number;
      pay_high: number;
      status: string;
      listed_at: Date;
    }[] = (
      await app.db.many<{
        id: string;
        title: string;
        company_name: string;
        city: string;
        pay_low: number;
        pay_high: number;
        status: string;
        listed_at: Date;
      }>(
        `select j.id, j.title, j.city, j.pay_low, j.pay_high, j.status, j.listed_at, c.name as company_name
         from jobs j join companies c on c.id = j.company_id
         where j.id = any($1::text[]) and j.status = 'listed'
         order by j.listed_at desc`,
        [batch.job_ids],
      )
    ).map((row) => row);
    if (jobs.length === 0) continue;
    const user = await app.db.one<{ email: string; display_name: string }>('select email, display_name from users where id = $1', [
      batch.user_id,
    ]);
    if (!user) continue;
    const label = alertLabel(batch.q, batch.cities, batch.roles, batch.remotes, batch.bands);
    const lines = jobs.map(
      (job) =>
        `${job.title} at ${job.company_name}, ${cityName(job.city)}, ${rangeText(job.pay_low, job.pay_high)}`,
    );
    const bodyText = `${lines.join('\n')}\n${config().publicUrl}/jobs/${jobs[0].id}`;
    await app.db.query(
      'insert into outbox (kind, to_email, subject, body) values ($1, $2, $3, $4)',
      [
        'job_alert',
        user.email,
        `${jobs.length === 1 ? '1 new lab job' : `${jobs.length} new lab jobs`} for ${label}`,
        bodyText,
      ],
    );
  }
}

function alertLabel(
  q: string,
  cities: string[],
  roles: string[],
  remotes: string[],
  bands: string[],
): string {
  const parts: string[] = [];
  const trimmed = q.trim();
  if (trimmed) parts.push(trimmed);
  for (const id of cities) parts.push(cityName(id));
  for (const id of roles) parts.push(ROLE_FAMILIES.find((r) => r.id === id)?.name ?? id);
  for (const id of remotes) parts.push(WORK_PATTERNS.find((w) => w.id === id)?.name ?? id);
  for (const id of bands) {
    parts.push(
      {
        under_4: 'Under ₹4 lakh',
        '4_6': '₹4–6 lakh',
        '6_8': '₹6–8 lakh',
        '8_10': '₹8–10 lakh',
        '10_plus': '₹10 lakh and over',
      }[id] ?? id,
    );
  }
  return parts.length === 0 ? 'All jobs' : parts.join(', ');
}

// A new match opens a batch or joins the open one.
export async function matchAlerts(app: App, jobId: string): Promise<void> {
  const job = await app.db.one<{
    id: string;
    title: string;
    company_id: string;
    city: string;
    role_family: string;
    remote: string;
    pay_low: number;
    pay_high: number;
  }>(
    `select id, company_id, city, role_family, remote, pay_low from jobs where id = $1 and status = 'listed'`,
    [jobId],
  );
  if (!job) return;
  const band =
    job.pay_low < 400000
      ? 'under_4'
      : job.pay_low < 600000
        ? '4_6'
        : job.pay_low < 800000
          ? '6_8'
          : job.pay_low < 1000000
            ? '8_10'
            : '10_plus';
  const alerts = await app.db.many<{
    id: string;
    user_id: string;
    q: string;
    cities: string[];
    roles: string[];
    remotes: string[];
    bands: string[];
  }>('select id, user_id, q, cities, roles, remotes, bands from alerts');
  for (const alert of alerts) {
    const chipMatch =
      (alert.cities.length === 0 || alert.cities.includes(job.city)) &&
      (alert.roles.length === 0 || alert.roles.includes(job.role_family)) &&
      (alert.remotes.length === 0 || alert.remotes.includes(job.remote)) &&
      (alert.bands.length === 0 || alert.bands.includes(band));
    if (!chipMatch) continue;
    if (alert.q.trim().length > 0) {
      try {
        const result = await meili.search('jobs', { q: alert.q, limit: 1000 });
        const hits = (result.hits as unknown as { id: string }[]) ?? [];
        if (!hits.some((hit) => hit.id === job.id)) continue;
      } catch {
        continue;
      }
    }
    await app.db.withClient(async (client) => {
      await client.query('begin');
      try {
        await client.query('update alerts set new_count = new_count + 1 where id = $1', [alert.id]);
        const open = await client.query<{ id: string }>(
          'select id from alert_batches where alert_id = $1 and sent_at is null limit 1',
          [alert.id],
        );
        if (open.rows.length > 0) {
          await client.query('update alert_batches set job_ids = array_append(job_ids, $2) where id = $1', [
            open.rows[0].id,
            job.id,
          ]);
        } else {
          const batchId = (
            await client.query<{ id: string }>(
              `insert into alert_batches (id, alert_id, first_matched_at, due_at, job_ids)
               values ($1, $2, $3, $4, $5) returning id`,
              [
                crypto.randomUUID(),
                alert.id,
                new Date(nowMs()),
                new Date(nowMs() + config().alertBatchSeconds * 1000),
                [job.id],
              ],
            )
          ).rows[0].id;
          void batchId;
        }
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });
    app.live.publish({ type: 'alert.matched', data: { alert_id: alert.id, new_count: null, owner: alert.user_id } });
  }
}
