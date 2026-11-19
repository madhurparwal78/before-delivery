import { query, withAdvisoryLock, withTransaction } from '../db/pool.js';
import { appendAuditEntry } from '../domain/audit.js';
import { CONTENT_COLUMNS, type ContentRow } from '../domain/content.js';
import { releaseContentItem, SCHEDULER_ACTOR } from '../domain/release.js';
import { voidLapsedSignoffs } from '../domain/releaserecord.js';
import type { StaffRole } from '../domain/roles.js';
import { queueGrantExpiryNotice } from './notifications.js';
import { queueJob } from './jobs.js';

const EMBARGO_LOCK = 9_100_000_000_001n;
const GRANTS_LOCK = 9_100_000_000_002n;
const RETENTION_LOCK = 9_100_000_000_003n;

const GRANTS_ACTOR = 'system:grants';
const RETENTION_ACTOR = 'system:retention';

async function releaseDueEmbargoes(): Promise<void> {
  const due = await query<{ id: string }>(
    `SELECT c.id FROM content_items c
      WHERE c.status = 'scheduled' AND c.release_at <= now()
        AND NOT EXISTS (
          SELECT 1 FROM content_items m
           WHERE m.kind = 'model' AND m.status = 'scheduled'
             AND m.linked_news_slug = c.slug AND c.kind = 'news'
        )
      ORDER BY c.release_at`,
  );
  for (const row of due.rows) {
    await withTransaction(async (tx) => {
      const locked = await tx.query<ContentRow>(
        `SELECT ${CONTENT_COLUMNS} FROM content_items
          WHERE id = $1 AND status = 'scheduled' AND release_at <= now()
          FOR UPDATE`,
        [row.id],
      );
      const item = locked.rows[0];
      if (item === undefined || item.release_at === null) return;
      await tx.query('UPDATE content_items SET version = version + 1 WHERE id = $1', [item.id]);
      await releaseContentItem(tx, item, item.release_at, SCHEDULER_ACTOR);
    });
  }
}

async function queueGrantExpiryNotices(): Promise<void> {
  const dueGrants = await query<{
    id: string;
    staff_email: string;
    role: StaffRole;
    expires_at: Date;
    name: string;
  }>(
    `SELECT g.id, g.staff_email, g.role, g.expires_at, s.name
       FROM role_grants g JOIN staff s ON s.email = g.staff_email
      WHERE g.revoked_at IS NULL AND g.expiry_notice_queued_at IS NULL
        AND g.expires_at <= now() + interval '604800 seconds'`,
  );
  for (const grant of dueGrants.rows) {
    await withTransaction(async (tx) => {
      const claimed = await tx.query(
        `UPDATE role_grants SET expiry_notice_queued_at = now()
          WHERE id = $1 AND expiry_notice_queued_at IS NULL`,
        [grant.id],
      );
      if ((claimed.rowCount ?? 0) === 0) return;
      await queueGrantExpiryNotice(tx, {
        to: { name: grant.name, email: grant.staff_email },
        grantId: grant.id,
        role: grant.role,
        expiresAt: grant.expires_at,
      });
    });
  }
}

async function voidSignoffsOfExpiredGrants(): Promise<void> {
  const expired = await query<{ id: string; staff_email: string }>(
    `SELECT id, staff_email FROM role_grants
      WHERE role = 'approver' AND revoked_at IS NULL AND expires_at <= now()
        AND lapse_swept_at IS NULL`,
  );
  for (const grant of expired.rows) {
    await withTransaction(async (tx) => {
      const claimed = await tx.query(
        `UPDATE role_grants SET lapse_swept_at = now()
          WHERE id = $1 AND lapse_swept_at IS NULL`,
        [grant.id],
      );
      if ((claimed.rowCount ?? 0) === 0) return;
      const stillApprover = await tx.query(
        `SELECT 1 FROM role_grants
          WHERE staff_email = $1 AND role = 'approver' AND revoked_at IS NULL
            AND expires_at > now()`,
        [grant.staff_email],
      );
      if ((stillApprover.rowCount ?? 0) > 0) return;
      await voidLapsedSignoffs(tx, grant.staff_email, GRANTS_ACTOR);
    });
  }
}

async function eraseRetiredApplications(): Promise<void> {
  const due = await query<{ id: string }>(
    `SELECT id FROM requisitions
      WHERE status = 'closed' AND retention_deadline IS NOT NULL
        AND retention_deadline <= now() AND retention_swept_at IS NULL`,
  );
  for (const requisition of due.rows) {
    await withTransaction(async (tx) => {
      const claimed = await tx.query(
        `UPDATE requisitions SET retention_swept_at = now()
          WHERE id = $1 AND retention_swept_at IS NULL`,
        [requisition.id],
      );
      if ((claimed.rowCount ?? 0) === 0) return;
      const applications = await tx.query<{ id: string; reference: string; resume_key: string | null }>(
        `SELECT id, reference, resume_key FROM applications
          WHERE requisition_id = $1 AND erased_at IS NULL FOR UPDATE`,
        [requisition.id],
      );
      for (const application of applications.rows) {
        await tx.query(
          `UPDATE applications
              SET name = 'Erased applicant', email = '', resume_key = NULL, erased_at = now()
            WHERE id = $1`,
          [application.id],
        );
        await tx.query(
          `UPDATE tracking_links SET retired_at = now()
            WHERE application_id = $1 AND retired_at IS NULL`,
          [application.id],
        );
        if (application.resume_key !== null) {
          await queueJob(tx, 'resume_erase', { key: application.resume_key }, `erase:${application.id}`);
        }
        await appendAuditEntry(tx, {
          actor: RETENTION_ACTOR,
          action: 'application.erase',
          targetType: 'application',
          targetId: application.id,
          detail: { reference: application.reference, requisition_id: requisition.id },
        });
      }
    });
  }
}

export function startScheduler(): void {
  const embargoTimer = setInterval(() => {
    void withAdvisoryLock(EMBARGO_LOCK, releaseDueEmbargoes).catch(() => undefined);
  }, 1000);
  embargoTimer.unref();

  const grantsTimer = setInterval(() => {
    void withAdvisoryLock(GRANTS_LOCK, async () => {
      await voidSignoffsOfExpiredGrants();
      await queueGrantExpiryNotices();
    }).catch(() => undefined);
  }, 5000);
  grantsTimer.unref();

  const retentionTimer = setInterval(() => {
    void withAdvisoryLock(RETENTION_LOCK, eraseRetiredApplications).catch(() => undefined);
  }, 10_000);
  retentionTimer.unref();
}
