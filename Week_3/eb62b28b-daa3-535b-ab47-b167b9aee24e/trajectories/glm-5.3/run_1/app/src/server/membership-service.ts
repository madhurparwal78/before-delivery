import type { AppContext } from "./route-context.js";
import { ApiError } from "./errors.js";
import { killBillReachable, paymentsUnavailable, refreshPendingMembership, joinPlus, changeCadence, cancelPlus, uncancelPlus } from "./membership-ops.js";
import { membershipFor } from "./memberships.js";
import { copy } from "../shared/copy.js";
import { instantZ } from "../shared/time.js";
import type { Cadence } from "../shared/enums.js";
import { sha256Hex } from "./crypto.js";

export async function membershipViewFor(ctx: AppContext, memberId: string) {
  const row = await membershipFor(ctx.db, memberId);
  if (!row) throw new ApiError(404, "not_found", copy("not_found"));
  return {
    state: row.state,
    cadence: row.cadence,
    renewalDate: row.renewal_date,
    plusUntil: row.plus_until,
    pendingCadence: row.pending_cadence,
    pendingFrom: row.pending_from,
  };
}

export async function joinPlusAction(ctx: AppContext, member: {
  id: string;
  name: string;
  email: string;
  accountState: string;
}, cadence: Cadence, requestKey: string | null, rawBody: Buffer) {
  if (member.accountState !== "active") {
    throw new ApiError(409, "account_closing", copy("account_closing_write"));
  }
  const existing = await membershipFor(ctx.db, member.id);
  if (!existing) throw new ApiError(404, "not_found", copy("not_found"));
  if (requestKey !== null) {
    const stored = await ctx.db.one<{
      request_hash: string;
      status: number;
      response_body: string;
    }>(
      `SELECT request_hash, status, response_body FROM request_keys WHERE member_id = $1 AND key = $2`,
      [member.id, requestKey]
    );
    const hash = sha256Hex(rawBody);
    if (stored) {
      if (stored.request_hash !== hash) {
        throw new ApiError(409, "request_key_reused", copy("request_key_reused"));
      }
      return { replayed: true as const, status: stored.status, body: JSON.parse(stored.response_body) as unknown };
    }
  }
  if (existing.state !== "free") {
    throw new ApiError(409, "already_plus", copy("already_plus"));
  }
  if (!(await killBillReachable(ctx))) {
    throw paymentsUnavailable();
  }
  const row = await joinPlus(ctx, member, cadence);
  const view = {
    state: row.state,
    cadence: row.cadence,
    renewalDate: row.renewal_date,
    plusUntil: row.plus_until,
    pendingCadence: row.pending_cadence,
    pendingFrom: row.pending_from,
  };
  const status = 201;
  if (requestKey !== null) {
    await ctx.db.exec(
      `INSERT INTO request_keys (member_id, key, request_hash, status, response_body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (member_id, key) DO NOTHING`,
      [member.id, requestKey, sha256Hex(rawBody), status, JSON.stringify({ membership: view })]
    );
  }
  return { replayed: false as const, status, body: { membership: view } };
}

export async function changeCadenceAction(ctx: AppContext, memberId: string, cadence: Cadence) {
  const row = await membershipFor(ctx.db, memberId);
  if (!row) throw new ApiError(404, "not_found", copy("not_found"));
  if (row.state === "free") throw new ApiError(409, "not_plus", copy("not_plus"));
  if (row.pending_cadence === cadence && row.state !== "free") {
    throw new ApiError(409, "same_cadence", copy("same_cadence"));
  }
  if (row.cadence === cadence && row.state === "active") {
    throw new ApiError(409, "same_cadence", copy("same_cadence"));
  }
  if (!row.kb_subscription_id) throw paymentsUnavailable();
  const fresh = await refreshPendingMembership(ctx, memberId);
  if (!(await killBillReachable(ctx))) {
    throw paymentsUnavailable();
  }
  await changeCadence(ctx, memberId, row.kb_subscription_id, cadence);
  return membershipViewFor(ctx, memberId);
}

export async function cancelPlusAction(ctx: AppContext, memberId: string) {
  const row = await membershipFor(ctx.db, memberId);
  if (!row) throw new ApiError(404, "not_found", copy("not_found"));
  if (row.state === "free") throw new ApiError(409, "not_plus", copy("not_plus"));
  if (row.state === "cancelled") throw new ApiError(409, "already_ending", copy("already_ending"));
  if (!row.kb_subscription_id) throw paymentsUnavailable();
  await refreshPendingMembership(ctx, memberId);
  if (!(await killBillReachable(ctx))) {
    throw paymentsUnavailable();
  }
  await cancelPlus(ctx, memberId, row.kb_subscription_id);
  return membershipViewFor(ctx, memberId);
}

export async function restoreMembershipAfterClosure(ctx: AppContext, memberId: string) {
  const row = await membershipFor(ctx.db, memberId);
  if (!row || !row.kb_subscription_id) return;
  if (row.state === "cancelled") {
    await uncancelPlus(ctx, row.kb_subscription_id);
    const sub = await ctx.killbill.getSubscription(row.kb_subscription_id);
    const chargedThrough = sub?.chargedThroughDate ?? null;
    await ctx.db.exec(
      `UPDATE memberships SET state = 'active', plus_until = NULL, renewal_date = $2, kb_charged_through = $2
       WHERE member_id = $1`,
      [memberId, chargedThrough]
    );
  }
}

export async function ensureMembershipCurrent(ctx: AppContext, memberId: string) {
  const row = await membershipFor(ctx.db, memberId);
  if (!row) return null;
  if (row.last_kb_check_at && Date.now() - row.last_kb_check_at.getTime() < 60_000) {
    return row;
  }
  try {
    return await refreshPendingMembership(ctx, memberId);
  } catch {
    return row;
  }
}

export function erasesAtView(erasesAt: Date | null): string | null {
  return erasesAt ? instantZ(erasesAt) : null;
}
