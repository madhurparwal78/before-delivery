import type { MemberStatus, Role, Seats } from "../../shared/types.js";
import { addDays, isoWeekOf, mondayOfIsoWeek, todayIn } from "../../shared/time.js";
import { memberJson, newToken, planner, requireOwner, requireWritable, type MemberRow } from "../auth.js";
import { sql, type Db } from "../db.js";
import { HttpError, json, parseJson, route } from "../http.js";
import { BillingUnavailable, cancelSeat } from "../killbill.js";
import { attemptNow, enqueue } from "../outbox.js";
import { isUuid } from "./tasks.js";
import * as check from "../validate.js";

/** Seat-holding members: the owner plus members whose status is active or invited. */
const SEAT_HOLDING = sql`removed_at IS NULL AND status IN ('active', 'invited')`;

async function seats(db: Db, workspaceId: string): Promise<Seats> {
  const [row] = await db<{ active: number; billed: number | null }[]>`
    SELECT (SELECT count(*)::int FROM members WHERE workspace_id = ${workspaceId} AND ${SEAT_HOLDING}) AS active,
           (SELECT e.seats FROM billing_events e WHERE e.workspace_id = w.id AND e.type = 'seats.changed' ORDER BY e.occurred_at DESC, e.event_id DESC LIMIT 1) AS billed
    FROM workspaces w WHERE w.id = ${workspaceId}`;
  return row;
}

route("GET", "/api/workspace/members", async (ctx) => {
  const who = await planner(ctx);
  requireOwner(who);
  const members = await sql<{ id: string; name: string | null; email: string; role: Role; status: MemberStatus }[]>`
    SELECT id, name, email, role, status FROM members
    WHERE workspace_id = ${who.member.workspace_id} AND removed_at IS NULL
    ORDER BY role = 'owner' DESC, created_at`;
  return json(200, { members, seats: await seats(sql, who.member.workspace_id) });
});

route(
  "POST",
  "/api/workspace/invitations",
  async (ctx) => {
    const who = await planner(ctx);
    requireOwner(who);
    requireWritable(who.workspace);
    const body = parseJson(ctx);
    check.settle({ email: check.email(body.email) });
    const email = String(body.email).trim();
    const workspaceId = who.member.workspace_id;
    const inserted = await sql
      .begin(async (tx) => {
        const [member] = await tx<MemberRow[]>`
          INSERT INTO members (workspace_id, role, status, email, time_zone, feed_token)
          VALUES (${workspaceId}, 'member', 'pending_billing', ${email}, ${who.member.time_zone}, ${newToken()})
          RETURNING id, workspace_id, role, status, name, email, time_zone, threshold_minutes`;
        const job = await enqueue(tx, workspaceId, "killbill.add_seat", { workspaceId, memberId: member.id, origin: ctx.origin });
        return { member, job };
      })
      .catch(async (error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "23505")) throw error;
        const [holder] = await sql<{ workspace_id: string | null }[]>`
          SELECT workspace_id FROM members WHERE lower(email) = lower(${email}) AND removed_at IS NULL`;
        throw holder?.workspace_id === workspaceId
          ? new HttpError(409, "already_member", `${email} is already in this workspace.`)
          : new HttpError(409, "email_taken", `${email} already has a Daybook.`);
      });
    const seat = await attemptNow(inserted.job);
    const member = memberJson(inserted.member);
    if (!seat.done) return json(202, { member, billing: "queued" });
    return json(201, { member, email: seat.followUp?.done ? "sent" : "queued" });
  },
  "json",
);

route("DELETE", "/api/workspace/members/{id}", async (ctx) => {
  const who = await planner(ctx);
  const workspaceId = who.member.workspace_id;
  const [target] = isUuid(ctx.params.id)
    ? await sql<{ id: string; role: Role; status: MemberStatus }[]>`
        SELECT id, role, status FROM members WHERE id = ${ctx.params.id} AND workspace_id = ${workspaceId} AND removed_at IS NULL`
    : [];
  if (!target) throw new HttpError(404, "not_found", "That member isn't in this workspace.");
  requireOwner(who);
  if (target.role === "owner") throw new HttpError(409, "cannot_remove_owner", "The owner can't be removed.");
  await sql.begin(async (tx) => {
    // The queued seat job locks the same row, so the status read here is final.
    const [current] = await tx<{ status: MemberStatus; email: string }[]>`
      SELECT status, email FROM members WHERE id = ${target.id} FOR UPDATE`;
    if (current.status !== "pending_billing") {
      try {
        await cancelSeat(workspaceId, target.id);
      } catch (error) {
        if (error instanceof BillingUnavailable) {
          throw new HttpError(503, "billing_unavailable", "Billing is unreachable, so nothing was changed. Try again shortly.");
        }
        throw error;
      }
    }
    await tx`UPDATE members SET removed_at = now(), invite_token_hash = NULL WHERE id = ${target.id}`;
    await tx`DELETE FROM sign_ins WHERE member_id = ${target.id}`;
    await tx`UPDATE outbox SET status = 'cancelled'
             WHERE status = 'pending' AND workspace_id = ${workspaceId}
               AND ((kind = 'killbill.add_seat' AND payload->>'memberId' = ${target.id})
                    OR (kind = 'mail' AND lower(payload->>'to') = lower(${current.email})))`;
  });
  return json(200, { seats: await seats(sql, workspaceId) });
});

route("GET", "/api/workspace/review", async (ctx) => {
  const who = await planner(ctx);
  requireOwner(who);
  const week = ctx.url.searchParams.get("week") ?? isoWeekOf(todayIn(who.member.time_zone, Date.now()));
  const monday = mondayOfIsoWeek(week);
  if (!monday) {
    throw new HttpError(422, "validation_failed", "Use an ISO week written as YYYY-Www.", { fields: { week: "Use an ISO week written as YYYY-Www." } });
  }
  const rows = await sql<{ memberId: string; name: string | null; plannedMinutes: number; doneMinutes: number }[]>`
    SELECT m.id AS "memberId", coalesce(m.name, m.email) AS name,
           coalesce(sum(t.estimate_minutes), 0)::int AS "plannedMinutes",
           coalesce(sum(t.estimate_minutes) FILTER (WHERE t.status = 'done'), 0)::int AS "doneMinutes"
    FROM members m
    LEFT JOIN tasks t ON t.member_id = m.id AND t.day_date BETWEEN ${monday}::date AND ${addDays(monday, 6)}::date
    WHERE m.workspace_id = ${who.member.workspace_id} AND m.removed_at IS NULL AND m.status IN ('active', 'invited')
    GROUP BY m.id, m.name, m.email, m.role, m.created_at
    ORDER BY m.role = 'owner' DESC, m.created_at`;
  return json(200, {
    week,
    members: rows,
    totals: {
      plannedMinutes: rows.reduce((sum, r) => sum + r.plannedMinutes, 0),
      doneMinutes: rows.reduce((sum, r) => sum + r.doneMinutes, 0),
    },
  });
});
