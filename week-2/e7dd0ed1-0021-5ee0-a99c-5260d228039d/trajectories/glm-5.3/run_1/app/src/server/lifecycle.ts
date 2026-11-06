import { one, rows, tx } from './db.js';
import { config } from './config.js';
import { isLocked, removeVersion } from './objects.js';
import { deletePartPrefix } from './storage.js';

export interface SweepResult { expired_versions: number; aborted_uploads: number; skipped_locked: number }

/** One lifecycle sweep: expires due noncurrent versions and aborts due uploads. */
export async function lifecycleSweep(): Promise<SweepResult> {
  const result: SweepResult = { expired_versions: 0, aborted_uploads: 0, skipped_locked: 0 };
  await expireDueVersions(result);
  await abortDueUploads(result);
  return result;
}

async function expireDueVersions(result: SweepResult): Promise<void> {
  const buckets = await rows<{ name: string; noncurrent_days: number | null; keep_newest_noncurrent: number }>(
    `SELECT b.name, l.noncurrent_days, l.keep_newest_noncurrent
     FROM buckets b JOIN lifecycle l ON l.bucket_name = b.name
     JOIN workspaces w ON w.slug = b.workspace_slug
     WHERE l.noncurrent_days IS NOT NULL AND w.status = 'active'`
  );
  const now = new Date();
  for (const b of buckets) {
    const keys = await rows<{ key: string }>(
      `SELECT DISTINCT key FROM versions WHERE bucket_name = $1 AND state = 'noncurrent'`, [b.name]
    );
    for (const { key } of keys) {
      const noncurrent = await rows<{ version_id: string; noncurrent_since: Date }>(
        `SELECT version_id, noncurrent_since FROM versions
         WHERE bucket_name = $1 AND key = $2 AND state = 'noncurrent'
         ORDER BY noncurrent_since DESC NULLS LAST, created_at DESC`, [b.name, key]
      );
      for (let i = 0; i < noncurrent.length; i++) {
        const v = noncurrent[i];
        if (i < b.keep_newest_noncurrent) continue;
        if (!v.noncurrent_since) continue;
        const dueAt = v.noncurrent_since.getTime() + b.noncurrent_days! * config.timing.day * 1000;
        if (now.getTime() < dueAt) continue;
        const full = await one<{ retain_until: Date | null; legal_hold: boolean; version_id: string }>(
          `SELECT retain_until, legal_hold, version_id FROM versions WHERE version_id = $1`, [v.version_id]
        );
        if (!full) continue;
        if (isLocked(full, now)) { result.skipped_locked++; continue; }
        await expireOne(v.version_id);
        result.expired_versions++;
      }
    }
  }
}

async function expireOne(vid: string): Promise<void> {
  const { versionById } = await import('./objects.js');
  const v = await versionById(vid);
  if (!v || v.state !== 'noncurrent') return;
  await removeVersion(v, 'lifecycle', false);
}

async function abortDueUploads(result: SweepResult): Promise<void> {
  const now = new Date();
  const due = await rows<{ upload_id: string; bucket_name: string }>(
    `SELECT u.upload_id, u.bucket_name FROM multipart_uploads u
     JOIN buckets b ON b.name = u.bucket_name
     JOIN lifecycle l ON l.bucket_name = u.bucket_name
     JOIN workspaces w ON w.slug = b.workspace_slug
     WHERE l.abort_multipart_days IS NOT NULL AND w.status = 'active'
       AND u.complete_result IS NULL
       AND u.initiated_at + (l.abort_multipart_days * $1 * interval '1 second') <= $2`,
    [config.timing.day, now]
  );
  for (const u of due) {
    const parts = await rows<{ part_number: number }>(`SELECT part_number FROM upload_parts WHERE upload_id = $1`, [u.upload_id]);
    await tx(async client => {
      await client.query(`DELETE FROM upload_parts WHERE upload_id = $1`, [u.upload_id]);
      await client.query(`DELETE FROM multipart_uploads WHERE upload_id = $1`, [u.upload_id]);
      await client.query(`DELETE FROM quota_reservations WHERE upload_id = $1`, [u.upload_id]);
    });
    await deletePartPrefix(u.upload_id, parts.map(p => p.part_number));
    result.aborted_uploads++;
  }
}

/** The lifecycle loop. */
export async function startLifecycleLoop(): Promise<void> {
  for (;;) {
    await new Promise(r => setTimeout(r, config.timing.lifecycleSweep * 1000));
    try { await lifecycleSweep(); } catch { /* retried next tick */ }
  }
}
