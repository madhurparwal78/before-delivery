import { config } from "../config";
import { inUnit } from "../db/unit";
import type { Unit } from "../db/unit";

type HistoryType = "claimed" | "renewed" | "expired" | "approved" | "rejected";

export async function addHistory(
  unit: Unit,
  postId: string,
  type: HistoryType,
  by: { id: string; name: string } | null,
  reason: string | null,
  excludeAuthor: string | null,
): Promise<void> {
  const row = await unit.first<{ at: Date }>(
    `INSERT INTO post_history (post_id, type, by_user_id, by_name, reason, at)
     VALUES ($1, $2, $3, $4, $5, app_now()) RETURNING at`,
    [postId, type, by?.id ?? null, by?.name ?? null, reason],
  );
  unit.emit({
    type: "queue.history",
    audience: ["moderators"],
    exclude: excludeAuthor ?? undefined,
    data: { post_id: postId, event: { type, by_name: by?.name ?? null, reason, at: row?.at.toISOString() ?? null } },
  });
}

/** Returns claims whose lease has ended to pending, with their history, queue and author events. */
export async function lapseExpiredClaims(): Promise<void> {
  await inUnit(async (unit) => {
    const lapsed = await unit.rows<{ id: string; author_id: string | null }>(
      `UPDATE posts SET state = 'pending', lapsed_by = claimed_by, claimed_by = NULL, claimed_at = NULL
        WHERE state = 'claimed' AND deleted_at IS NULL AND claimed_at + make_interval(secs => $1) <= app_now()
        RETURNING id, author_id`,
      [config.limits.claimLapseSeconds],
    );
    for (const post of lapsed) {
      await addHistory(unit, post.id, "expired", null, null, post.author_id);
      unit.emit({
        type: "queue.changed",
        audience: ["moderators"],
        exclude: post.author_id ?? undefined,
        data: { post_id: post.id, state: "pending", by_name: null, by_user: null },
      });
      if (post.author_id) {
        unit.emit({ type: "post.state", audience: [`user:${post.author_id}`], data: { post_id: post.id, state: "pending", reason: null } });
      }
      await unit.audit("claim_lapsed", post.id, null, {});
    }
  });
}
