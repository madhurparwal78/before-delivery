import type { AppContext } from "./route-context.js";
import type { Database } from "./db.js";
import { endSessionsFor } from "./session.js";

/**
 * Erasure sweep: within 5 seconds after erasesAt, erase the member's personal
 * data everywhere. Runs every second.
 */
export async function runErasureSweep(ctx: AppContext): Promise<void> {
  await transitionToErasing(ctx.db);
  await eraseDueMembers(ctx);
  await completeErasedMembers(ctx);
}

async function transitionToErasing(db: Database): Promise<void> {
  await db.exec(
    `UPDATE members SET account_state = 'erasing'
     WHERE account_state = 'closing' AND erases_at IS NOT NULL AND erases_at <= now()`
  );
}

async function eraseDueMembers(ctx: AppContext): Promise<void> {
  const rows = await ctx.db.query<{ id: string }>(
    `SELECT id FROM members WHERE account_state = 'erasing' AND erased_at IS NULL`
  );
  for (const row of rows) {
    await eraseMember(ctx, row.id);
  }
}

async function eraseMember(ctx: AppContext, memberId: string): Promise<void> {
  const db = ctx.db;
  await endSessionsFor(db, "member", memberId);
  await db.exec(`DELETE FROM visit_pages WHERE draw_id IN (SELECT id FROM draws WHERE member_id = $1)`, [memberId]);
  await db.exec(`DELETE FROM results WHERE member_id = $1`, [memberId]);
  await db.exec(`DELETE FROM result_history WHERE result_id NOT IN (SELECT id FROM results)`);
  await db.exec(`DELETE FROM draw_reports WHERE draw_id IN (SELECT id FROM draws WHERE member_id = $1)`, [memberId]);
  await db.exec(`DELETE FROM draws WHERE member_id = $1`, [memberId]);
  await db.exec(`DELETE FROM longevity_plans WHERE member_id = $1`, [memberId]);
  await db.exec(`DELETE FROM blends WHERE member_id = $1`, [memberId]);
  await db.exec(`DELETE FROM messages WHERE member_id = $1`, [memberId]);
  await db.exec(`DELETE FROM message_threads WHERE member_id = $1`, [memberId]);
  await db.exec(`DELETE FROM pending_mail WHERE member_id = $1 AND sent_at IS NULL`, [memberId]);
  await db.exec(`DELETE FROM request_keys WHERE member_id = $1`, [memberId]);
  await db.exec(`DELETE FROM rate_events WHERE member_id = $1`, [memberId]);
  // The email column is NOT NULL, so the erased row keeps an unidentifiable per-member placeholder.
  await db.exec(
    `UPDATE members SET name = 'Erased member', email = $2, phone = NULL, date_of_birth = NULL,
      sex = NULL, state = NULL, time_zone = NULL, address_line1 = NULL, address_line2 = NULL,
      city = NULL, postal_code = NULL, gate_notes = NULL, password_hash = '', erased_at = now(),
      minio_deletions_pending = 1
     WHERE id = $1`,
    [memberId, `erased-${memberId}@erased.invalid`]
  );
  await db.exec(
    `UPDATE receipts SET member_name = 'Erased member' WHERE member_id = $1`,
    [memberId]
  );
  const membership = await db.one<{ kb_subscription_id: string | null; state: string }>(
    `SELECT kb_subscription_id, state FROM memberships WHERE member_id = $1`,
    [memberId]
  );
  if (membership?.kb_subscription_id) {
    const accountId = await ctx.killbill.getAccountByExternalKey(memberId);
    if (accountId) {
      await ctx.killbill.updateAccountContact(accountId.accountId, {
        name: "Erased member",
        email: null,
        phone: null,
      }).catch(() => undefined);
    }
  }
  const attachments = await db.query<{ id: string; member_id: string }>(
    `SELECT id, member_id FROM attachments WHERE member_id = $1`,
    [memberId]
  );
  for (const attachment of attachments) {
    await ctx.store.delete(ctx.store.attachmentOriginalKey(attachment.member_id, attachment.id)).catch(() => undefined);
    await ctx.store.delete(ctx.store.attachmentCleanKey(attachment.member_id, attachment.id)).catch(() => undefined);
  }
  await db.exec(`DELETE FROM attachments WHERE member_id = $1`, [memberId]);
}

async function completeErasedMembers(ctx: AppContext): Promise<void> {
  const rows = await ctx.db.query<{ id: string; minio_deletions_pending: number }>(
    `SELECT id, minio_deletions_pending FROM members WHERE account_state = 'erasing' AND erased_at IS NOT NULL`
  );
  for (const row of rows) {
    if (row.minio_deletions_pending === 1) {
      // MinIO deletions were issued in eraseMember; confirm by listing nothing left.
      const leftovers = await ctx.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM attachments WHERE member_id = $1`,
        [row.id]
      );
      if (leftovers[0]?.count === "0") {
        await ctx.db.exec(
          `UPDATE members SET account_state = 'erased', minio_deletions_pending = 0 WHERE id = $1`,
          [row.id]
        );
      }
    }
  }
}

/** Check pending memberships in Kill Bill at least every 60 seconds. */
export async function runPendingMembershipSweep(ctx: AppContext): Promise<void> {
  const rows = await ctx.db.query<{ member_id: string }>(
    `SELECT m.member_id FROM memberships m
     JOIN members mem ON mem.id = m.member_id
     WHERE mem.account_state <> 'erased'
       AND (m.state = 'pending' OR (m.kb_subscription_id IS NOT NULL AND (m.last_kb_check_at IS NULL OR m.last_kb_check_at < now() - interval '60 seconds')))`
  );
  const { ensureMembershipCurrent } = await import("./membership-service.js");
  for (const row of rows) {
    try {
      await ensureMembershipCurrent(ctx, row.member_id);
    } catch {
      // Kill Bill unreachable: the next sweep retries.
    }
  }
}
