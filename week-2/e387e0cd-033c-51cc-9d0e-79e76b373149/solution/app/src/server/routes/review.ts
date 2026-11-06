// The review queue: one winner per claim (decided by the database), decisions and stale decisions.
import { config } from "../config.js";
import { allow, staff, type Staff } from "../auth.js";
import { one, pool, tx } from "../db.js";
import { refuse } from "../errors.js";
import { objectBody, type Ctx, type Router } from "../http.js";
import { deliverLater } from "../smtp.js";
import { CASE_SELECT, type CaseRow } from "../cases/record.js";
import { alreadyDecided, decideReview, findCase, listCases } from "../cases/transitions.js";
import { caseReply, validReason } from "./cases.js";
import { formatDateTime, isoInstant, secondsUntil, stamp } from "../../shared/format.js";

function claimBody(c: CaseRow, now: number) {
  return {
    memberId: c.claim_member_id,
    memberName: c.claim_member_name,
    claimedAt: isoInstant(c.claimed_at!.getTime()),
    endsAt: isoInstant(c.claim_ends_at!.getTime()),
    remainingSeconds: secondsUntil(c.claim_ends_at!, now),
  };
}

const claimActive = (c: CaseRow, now: number): boolean =>
  c.claim_member_id !== null && c.claim_ends_at !== null && c.claim_ends_at.getTime() > now;

/** A review case of this workspace, or 404. */
async function reviewCase(ctx: Ctx, who: Staff): Promise<CaseRow> {
  const c = await findCase(pool, who.workspace, ctx.params.caseId);
  if (c.path !== "review" || c.archived_at) throw refuse.notFound();
  return c;
}

export function registerReview(router: Router): void {
  router.add("GET", "/api/w/:slug/review", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "compliance_analyst", "support_agent");
    const now = Date.now();
    const found = (await listCases(pool, who.workspace, "c.status = 'in_review' AND c.archived_at IS NULL")).reverse();
    return {
      status: 200,
      json: {
        cases: found.map((c) => ({
          id: c.id, reference: c.reference, counterparty: { id: c.counterparty_id, name: c.cp_name },
          fiatValueCents: c.fiat_value_cents, currency: c.currency, createdAt: isoInstant(c.created_at.getTime()),
          claim: claimActive(c, now) ? claimBody(c, now) : null,
        })),
        now: isoInstant(now),
      },
    };
  });

  router.add("POST", "/api/w/:slug/review/:caseId/claim", async (ctx) => {
    const who = await staff(ctx);
    const c = await reviewCase(ctx, who);
    allow(who, "compliance_analyst");
    ctx.json();
    if (c.decision) throw alreadyDecided(c, who.workspace);
    if (c.status !== "in_review") throw refuse.conflict("case_closed", "This case is already closed.");
    const now = Date.now();
    const claimedAt = stamp(now);
    const won = await one<CaseRow>(pool,
      `UPDATE cases SET claim_member_id = $2, claim_member_name = $3, claimed_at = $4, claim_ends_at = $5
        WHERE id = $1 AND status = 'in_review' AND decision IS NULL AND (claim_member_id IS NULL OR claim_ends_at <= $6)
        RETURNING *`,
      [c.id, who.member.id, who.member.name, claimedAt, new Date(claimedAt.getTime() + config.timers.reviewClaim * 1000), new Date(now)]);
    if (won) return { status: 200, json: { claim: claimBody(won, now) } };
    const held = (await one<CaseRow>(pool, `${CASE_SELECT} WHERE c.id = $1`, [c.id]))!;
    if (held.decision) throw alreadyDecided(held, who.workspace);
    if (held.claim_member_id === who.member.id && claimActive(held, now)) return { status: 200, json: { claim: claimBody(held, now) } };
    if (!claimActive(held, now)) throw refuse.conflict("case_closed", "This case is already closed.");
    throw refuse.conflict("already_claimed",
      `Claimed by ${held.claim_member_name} at ${formatDateTime(held.claimed_at!.getTime(), who.workspace.timeZone, who.workspace.city)}.`);
  });

  router.add("POST", "/api/w/:slug/review/:caseId/decision", async (ctx) => {
    const who = await staff(ctx);
    await reviewCase(ctx, who);
    allow(who, "compliance_analyst");
    const body = objectBody(ctx.json());
    const mail = await tx(async (db) => {
      const c = await findCase(db, who.workspace, ctx.params.caseId, true);
      const now = Date.now();
      if (c.decision) throw alreadyDecided(c, who.workspace);
      if (c.claim_member_id !== who.member.id || !claimActive(c, now)) {
        throw refuse.conflict("claim_not_held", "Claim this case before deciding.");
      }
      const fields: Record<string, string> = {};
      if (body.decision !== "accept" && body.decision !== "reject") fields.decision = "Choose Accept or Reject.";
      const reason = validReason(body.reason);
      if (reason === null) fields.reason = "Enter a reason.";
      if (reason === null || Object.keys(fields).length) throw refuse.invalid(fields);
      return decideReview(db, who.workspace, c, body.decision === "accept", reason, who.member.name, now);
    });
    if (mail) deliverLater(mail);
    return caseReply(pool, who, ctx.params.caseId);
  });
}
