import { config } from '../config.js';
import { withTransaction, withClient, query, connect } from '../platform/db.js';
import { claimDueJob, completeJob, failJob, reclaimLapsedLeases, queueJob } from '../http/jobs.js';
import { sendMail, probeMail } from '../platform/mail.js';
import { deleteObject, probeStorage, storageStatus } from '../platform/storage.js';
import { writeAudit } from '../platform/audit.js';
import { sampleKeysToEnsure } from '../media/generate.js';
import { putObject, getObject } from '../platform/storage.js';
import { refreshSearchIndex, indexContentItem } from '../db/migrate.js';
import { getContentById, contentToView } from '../http/content.js';
import { readTimeMinutes } from '../domain/lifecycles.js';
import { randomBytes } from 'node:crypto';

const instanceId = `instance-${randomBytes(6).toString('hex')}`;

let running = false;
let timer: NodeJS.Timeout | null = null;

export function schedulerStatus(): { instanceId: string; running: boolean } {
  return { instanceId, running };
}

export async function ensureSamplesUploaded(): Promise<void> {
  // Queue a sample_upload job for any sample object missing at start.
  for (const spec of sampleKeysToEnsure()) {
    const exists = await getObject(spec.key);
    if (!exists.ok) {
      await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT id FROM jobs WHERE kind = 'sample_upload' AND state <> 'done' AND payload->>'key' = $1`,
          [spec.key],
        );
        if (existing.rows.length === 0) {
          await queueJob(client, 'sample_upload', { key: spec.key });
        }
      });
    }
  }
}

async function runDueWork(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // 1. Reclaim lapsed leases.
    await withClient(async (client) => {
      await reclaimLapsedLeases(client);
    });

    // 2. Fire due embargoes (database lease keeps this exactly-once).
    await withClient(async (client) => {
      await fireDueEmbargoes(client);
    });

    // 3. Void sign-offs whose grants expired (within 60s of expiry).
    await withClient(async (client) => {
      await voidExpiredSignoffs(client);
    });

    // 4. Queue grant expiry notices within 7 days.
    await withClient(async (client) => {
      await queueExpiryNotices(client);
    });

    // 5. Retention erasure past the stored deadline.
    await withClient(async (client) => {
      await runRetentionSweep(client);
    });

    // 6. Job delivery.
    await deliverJobs();
  } catch (e) {
    console.error('scheduler tick error:', (e as Error).message);
  } finally {
    running = false;
  }
}

async function fireDueEmbargoes(client: import('../platform/db.js').DbClient): Promise<void> {
  // Claim the advisory slot so only one instance processes releases at a time.
  const locked = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(474731) AS locked`,
  );
  if (!locked.rows[0]?.locked) return;
  try {
    const due = await client.query<{ content_id: string; release_at: Date }>(
      `SELECT content_id, release_at FROM embargo_releases
       WHERE released = false AND release_at <= now()
       ORDER BY release_at ASC
       LIMIT 20`,
    );
    for (const row of due.rows) {
      const contentId = row.content_id;
      const published = await publishScheduled(client, contentId, new Date(row.release_at));
      if (!published) {
        await client.query(`UPDATE embargo_releases SET released = true WHERE content_id = $1`, [contentId]);
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(474731)`);
  }
}

/**
 * Publish a scheduled item and its linked announcement. Returns false when the
 * item is no longer scheduled (for instance already withdrawn), in which case
 * the embargo row is retired without publishing.
 */
async function publishScheduled(
  client: import('../platform/db.js').DbClient,
  contentId: string,
  at: Date,
): Promise<boolean> {
  return client.query('BEGIN').then(async () => {
    const content = await getContentById(client, contentId);
    if (!content || content.status !== 'scheduled') {
      await client.query('COMMIT');
      return false;
    }
    const readTime = readTimeMinutes(content.body, content.claims);
    await client.query(
      `UPDATE content_items SET status = 'published', published_at = $1, read_time_minutes = $2,
         release_at = NULL, version = version + 1, updated_at = now()
       WHERE id = $3`,
      [at.toISOString(), readTime, contentId],
    );
    await client.query(
      `INSERT INTO publication_history (content_id, published_at) VALUES ($1, $2)
       ON CONFLICT (content_id) DO UPDATE SET published_at = $2, withdrawn_at = NULL`,
      [contentId, at.toISOString()],
    );
    await client.query(`UPDATE embargo_releases SET released = true WHERE content_id = $1`, [contentId]);
    await writeAudit(client, {
      actor: 'system:scheduler',
      action: 'content.release',
      targetType: 'content',
      targetId: contentId,
      detail: { slug: content.slug, published_at: at.toISOString() },
    });
    await indexContentItem(client, contentId);
    if (content.kind === 'model' && content.linked_news_slug) {
      const linkedRows = await client.query<{ id: string; status: string; body: string; claims: unknown }>(
        `SELECT id, status, body, claims FROM content_items WHERE slug = $1 AND kind = 'news'`,
        [content.linked_news_slug],
      );
      const linked = linkedRows.rows[0];
      if (linked && linked.status === 'scheduled') {
        const linkedReadTime = readTimeMinutes(linked.body, Array.isArray(linked.claims) ? (linked.claims as never) : null);
        await client.query(
          `UPDATE content_items SET status = 'published', published_at = $1, read_time_minutes = $2,
             release_at = NULL, version = version + 1, updated_at = now()
           WHERE id = $3`,
          [at.toISOString(), linkedReadTime, linked.id],
        );
        await client.query(
          `INSERT INTO publication_history (content_id, published_at) VALUES ($1, $2)
           ON CONFLICT (content_id) DO UPDATE SET published_at = $2, withdrawn_at = NULL`,
          [linked.id, at.toISOString()],
        );
        await client.query(`UPDATE embargo_releases SET released = true WHERE content_id = $1`, [linked.id]);
        await writeAudit(client, {
          actor: 'system:scheduler',
          action: 'content.release',
          targetType: 'content',
          targetId: linked.id,
          detail: { slug: content.linked_news_slug, published_at: at.toISOString() },
        });
        await indexContentItem(client, linked.id);
      }
    }
    await refreshSearchIndex(client);
    await client.query('COMMIT');
    return true;
  }).catch(async (e) => {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  });
}

async function voidExpiredSignoffs(client: import('../platform/db.js').DbClient): Promise<void> {
  const locked = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(474732) AS locked`);
  if (!locked.rows[0]?.locked) return;
  try {
    const expired = await client.query<{ content_id: string; safety_by: string | null; legal_by: string | null; safety_expires: Date | null; legal_expires: Date | null }>(
      `SELECT rr.content_id, rr.safety_by, rr.legal_by,
              gs.expires_at AS safety_expires, gl.expires_at AS legal_expires
       FROM release_records rr
       LEFT JOIN grants gs ON gs.staff_email = rr.safety_by AND gs.role = 'approver'
         AND gs.revoked_at IS NULL AND gs.expires_at > now()
       LEFT JOIN grants gl ON gl.staff_email = rr.legal_by AND gl.role = 'approver'
         AND gl.revoked_at IS NULL AND gl.expires_at > now()
       WHERE rr.status <> 'cleared' AND rr.status <> 'open'`,
    );
    for (const row of expired.rows) {
      if (row.safety_by && row.safety_expires === null) {
        await voidSignoff(client, row.content_id, 'safety', row.safety_by);
      }
      if (row.legal_by && row.legal_expires === null) {
        await voidSignoff(client, row.content_id, 'legal', row.legal_by);
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(474732)`);
  }
}

async function voidSignoff(
  client: import('../platform/db.js').DbClient,
  contentId: string,
  kind: 'safety' | 'legal',
  signer: string,
): Promise<void> {
  const { voidSignoffsFor } = await import('../http/release-record.js');
  await client.query('BEGIN').then(async () => {
    await voidSignoffsFor(client, contentId, 'system:grants', 'signoff_lapsed', kind, signer);
    await client.query('COMMIT');
  }).catch(async (e) => {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  });
}

async function queueExpiryNotices(client: import('../platform/db.js').DbClient): Promise<void> {
  const locked = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(474733) AS locked`);
  if (!locked.rows[0]?.locked) return;
  try {
    const due = await client.query<{ id: string; staff_email: string; role: string; expires_at: Date }>(
      `SELECT g.id, g.staff_email, g.role, g.expires_at FROM grants g
       WHERE g.revoked_at IS NULL AND g.expires_at > now()
         AND g.expires_at <= now() + interval '604800 seconds'
         AND NOT EXISTS (
           SELECT 1 FROM expiry_notices en JOIN jobs j ON j.id = en.job_id
           WHERE en.grant_id = g.id AND j.state <> 'dead'
         )`,
    );
    const { queueMail } = await import('../http/jobs.js');
    for (const grant of due.rows) {
      await client.query('BEGIN').then(async () => {
        const jobId = await queueMail(client, {
          to: { name: grant.staff_email, email: grant.staff_email },
          subject: `Your ${grant.role} access ends soon`,
          body: `Your ${grant.role} grant expires at ${new Date(grant.expires_at).toISOString()}.`,
        });
        await client.query(
          `INSERT INTO expiry_notices (grant_id, job_id) VALUES ($1, $2) ON CONFLICT (grant_id) DO NOTHING`,
          [grant.id, jobId],
        );
        await client.query('COMMIT');
      }).catch(async () => {
        await client.query('ROLLBACK').catch(() => {});
      });
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(474733)`);
  }
}

async function runRetentionSweep(client: import('../platform/db.js').DbClient): Promise<void> {
  const locked = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(474734) AS locked`);
  if (!locked.rows[0]?.locked) return;
  try {
    const due = await client.query<{ id: string; resume_key: string | null; reference: string }>(
      `SELECT a.id, a.resume_key, a.reference FROM applications a
       JOIN requisitions r ON r.id = a.requisition_id
       WHERE r.status = 'closed' AND r.retention_deadline IS NOT NULL
         AND r.retention_deadline < now()
         AND a.name <> 'Erased applicant'`,
    );
    for (const app of due.rows) {
      await client.query('BEGIN').then(async () => {
        if (app.resume_key) {
          await queueJob(client, 'resume_erase', { key: app.resume_key, application_id: app.id });
        }
        await client.query(
          `UPDATE applications SET name = 'Erased applicant', email = '', token_digest = NULL WHERE id = $1`,
          [app.id],
        );
        await writeAudit(client, {
          actor: 'system:retention',
          action: 'application.erase',
          targetType: 'application',
          targetId: app.id,
          detail: { reference: app.reference },
        });
        await client.query('COMMIT');
      }).catch(async () => {
        await client.query('ROLLBACK').catch(() => {});
      });
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(474734)`);
  }
}

async function deliverJobs(): Promise<void> {
  const mailOk = storageStatus() ? await probeMail() : await probeMail();
  const storageOk = await probeStorage();
  const kinds: import('../http/jobs.js').JobKind[] = [];
  if (mailOk) kinds.push('mail');
  if (storageOk) kinds.push('resume_erase', 'sample_upload');
  for (let i = 0; i < 10; i += 1) {
    let claimed = false;
    await withTransaction(async (client) => {
      const outcome = await claimDueJob(client, instanceId, kinds);
      if (outcome.claimed) {
        claimed = true;
        await processJob(client, outcome.job);
      }
    }).catch((e) => {
      console.error('job delivery error:', (e as Error).message);
    });
    if (!claimed) break;
  }
}

async function processJob(client: import('../platform/db.js').DbClient, job: import('../http/jobs.js').JobRow): Promise<void> {
  const payload = job.payload;
  if (job.kind === 'mail') {
    const to = payload.to as { name: string; email: string } | undefined;
    if (!to) {
      await completeJob(client, job.id);
      return;
    }
    const result = await sendMail({
      to,
      subject: String(payload.subject ?? ''),
      messageId: `outbox-${job.id}@aldermoor.example`,
      body: String(payload.body ?? ''),
    });
    if (result.accepted) {
      await completeJob(client, job.id);
    } else {
      await failJob(client, job.id, result.refused ? 'mail_refused' : 'mail_unreachable', result.refused);
    }
    return;
  }
  if (job.kind === 'resume_erase') {
    const key = String(payload.key ?? '');
    const result = await deleteObject(key);
    if (result.ok) {
      await completeJob(client, job.id);
    } else {
      await failJob(client, job.id, 'storage_refused', true);
    }
    return;
  }
  if (job.kind === 'sample_upload') {
    const key = String(payload.key ?? '');
    const spec = sampleKeysToEnsure().find((s) => s.key === key);
    if (!spec) {
      await completeJob(client, job.id);
      return;
    }
    const generated = spec.generate();
    const result = await putObject(key, generated.bytes, generated.contentType);
    if (result.ok) {
      await completeJob(client, job.id);
    } else {
      await failJob(client, job.id, result.refused ? 'storage_refused' : 'storage_unreachable', result.refused);
    }
    return;
  }
  await completeJob(client, job.id);
}

export function startScheduler(): void {
  const interval = Math.max(1, Math.min(config.outboxRetrySeconds, 5)) * 1000;
  timer = setInterval(() => {
    void runDueWork();
  }, interval);
  timer.unref?.();
  // Also probe services every 5 seconds for readiness reporting.
  const probeTimer = setInterval(() => {
    void probeStorage();
    void probeMail();
  }, config.probeIntervalMs);
  probeTimer.unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export { runDueWork, instanceId };
