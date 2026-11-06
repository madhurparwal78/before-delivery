import { newId } from "../config";
import { now, nowMs } from "../clock";
import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError, conflict } from "../errors";
import type { PackAttemptRow } from "../types";

export type PackMember = { id: string; studio_id: string; email: string; name: string; card_status: string; active: boolean };
import { balanceOf, postMovement } from "./ledger";
import * as kb from "../services/killbill";
import { publish } from "../events";
import { dayStart, today } from "../studiodays";

// Credit packs: at most three per studio day counting completed purchases, pending
// purchases and held attempts. A purchase id is chosen the first time a key is used
// and stays with that key forever.

export const packTxKey = (purchaseId: string): string => `kd-pack-${purchaseId}`;

export type PackPurchaseResponse = { status: number; body: Record<string, unknown> };

function purchaseBody(attempt: PackAttemptRow, balanceCents: number): Record<string, unknown> {
  return {
    purchase: {
      id: attempt.id,
      pack_id: attempt.pack_id,
      amount_cents: attempt.amount_cents,
      created_at: attempt.created_at,
      status: attempt.state === "completed" ? "completed" : "pending",
    },
    balance_cents: balanceCents,
  };
}

async function countDayAttempts(client: Parameters<typeof q>[0], memberId: string, day: string): Promise<number> {
  const row = await one<{ n: string }>(
    client,
    `SELECT COUNT(*) AS n FROM pack_attempts
      WHERE member_id = $1 AND studio_day = $2 AND state IN ('held','pending','completed')`,
    [memberId, day],
  );
  return Number(row?.n ?? 0);
}

export function packLimitError(nextDay: string, nextDayStartIso: string): ApiError {
  return conflict("pack_limit_reached", "You can buy at most 3 credit packs a day. Try again after midnight studio time.", {
    next_purchase_at: nextDayStartIso,
  });
}

// Buy one pack under an idempotency key. Called with the key lock already held.
export async function buyPack(member: PackMember, tz: string, packId: string, amountCents: number, key: string): Promise<PackPurchaseResponse> {
  if (!member.active) throw conflict("member_inactive", "This account is not active. Ask the studio owner.");
  if (member.card_status !== "on_file") throw conflict("no_card_on_file", "Add a card at the front desk before buying credit.");

  const day = today(tz, nowMs());
  const nextDayStart = dayStart(day, tz) + 86400000;
  const attempt = await one<PackAttemptRow>(pool, "SELECT * FROM pack_attempts WHERE studio_id = $1 AND idempotency_key = $2", [member.studio_id, key]);

  let current: PackAttemptRow;
  if (attempt) {
    if (attempt.state === "completed") {
      const balance = await balanceOf(pool, member.id);
      return { status: 201, body: purchaseBody(attempt, balance) };
    }
    if (attempt.state === "pending") {
      const balance = await balanceOf(pool, member.id);
      return { status: 202, body: purchaseBody(attempt, balance) };
    }
    if (attempt.state === "released") {
      // A later retry with that key takes a place again.
      await tx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.packDay(member.id, day)]);
        const used = await countDayAttempts(client, member.id, day);
        if (used >= 3) throw packLimitError(day, new Date(nextDayStart).toISOString());
        await client.query("UPDATE pack_attempts SET state = 'held', studio_day = $1, last_kb_call_ms = $2 WHERE id = $3", [day, nowMs(), attempt.id]);
      });
      const fresh = await one<PackAttemptRow>(pool, "SELECT * FROM pack_attempts WHERE id = $1", [attempt.id]);
      current = fresh ?? attempt;
    } else {
      // held: retry of a still-held attempt; does not count again.
      current = attempt;
    }
  } else {
    // First use of this key: take a place in the day's allowance, or refuse.
    const id = newId();
    const created = await tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.packDay(member.id, day)]);
      const used = await countDayAttempts(client, member.id, day);
      if (used >= 3) throw packLimitError(day, new Date(nextDayStart).toISOString());
      const rows = await q<PackAttemptRow>(
        client,
        `INSERT INTO pack_attempts (id, studio_id, member_id, idempotency_key, pack_id, amount_cents, studio_day, state, created_at, last_kb_call_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'held',$8,$9)
         ON CONFLICT (studio_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [id, member.studio_id, member.id, key, packId, amountCents, day, now(), nowMs()],
      );
      return rows[0];
    });
    if (!created) {
      const again = await one<PackAttemptRow>(pool, "SELECT * FROM pack_attempts WHERE studio_id = $1 AND idempotency_key = $2", [member.studio_id, key]);
      if (!again) throw new ApiError(500, "internal", "Something went wrong. Try again.");
      current = again;
    } else {
      current = created;
    }
  }

  // Run the purchase with this key's fixed transaction key.
  const txKey = packTxKey(current.id);
  try {
    const outcome = await kb.purchase({ id: member.id, name: member.name, email: member.email }, txKey, amountCents, 5000);
    if (outcome.result === "success") {
      const balance = await completePack(current, member.studio_id, member.id);
      const fresh = await one<PackAttemptRow>(pool, "SELECT * FROM pack_attempts WHERE id = $1", [current.id]);
      return { status: 201, body: purchaseBody(fresh ?? current, balance) };
    }
    // Sent but no answer in time: pending, no pair posted.
    await pool.query("UPDATE pack_attempts SET state = 'pending', last_kb_call_ms = $1 WHERE id = $2 AND state = 'held'", [nowMs(), current.id]);
    const fresh = await one<PackAttemptRow>(pool, "SELECT * FROM pack_attempts WHERE id = $1", [current.id]);
    const balance = await balanceOf(pool, member.id);
    return { status: 202, body: purchaseBody(fresh ?? current, balance) };
  } catch (e) {
    if (e instanceof kb.KbCallFailed && e.kind === "timeout") {
      await pool.query("UPDATE pack_attempts SET state = 'pending', last_kb_call_ms = $1 WHERE id = $2 AND state = 'held'", [nowMs(), current.id]);
      const fresh = await one<PackAttemptRow>(pool, "SELECT * FROM pack_attempts WHERE id = $1", [current.id]);
      const balance = await balanceOf(pool, member.id);
      return { status: 202, body: purchaseBody(fresh ?? current, balance) };
    }
    throw new ApiError(503, "billing_unavailable", "Billing is unavailable. Try again in a few minutes; this purchase is never charged twice.");
  }
}

// Post the pack pair exactly once and mark the purchase completed.
export async function completePack(attempt: PackAttemptRow, studioId: string, memberId: string): Promise<number> {
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.member(memberId)]);
    const updated = await one<PackAttemptRow>(
      client,
      "UPDATE pack_attempts SET state = 'completed' WHERE id = $1 AND state IN ('held','pending') RETURNING *",
      [attempt.id],
    );
    if (!updated) return await balanceOf(client, memberId);
    const posted = await postMovement(client, {
      studioId,
      memberId,
      kind: "pack",
      amountCents: attempt.amount_cents,
      purchaseId: attempt.id,
      at: now(),
    });
    return posted.balanceCents;
  });
}

// The settler's work for one pack attempt. Returns when the attempt is finished or
// released. Caller holds an advisory lock on the attempt id.
export async function settlePackAttempt(attempt: PackAttemptRow): Promise<void> {
  const member = await one<PackMember>(pool, "SELECT id, studio_id, email, name, card_status, active FROM people WHERE id = $1", [attempt.member_id]);
  if (!member) return;
  const txKey = packTxKey(attempt.id);
  let found = false;
  try {
    found = await kb.lookupPurchase(txKey, 30000);
  } catch {
    return; // Kill Bill did not answer; try again next cycle.
  }
  if (found) {
    await completePack(attempt, attempt.studio_id, attempt.member_id);
    await publish(pool, "credit", attempt.member_id, attempt.studio_id, { memberId: attempt.member_id });
    return;
  }
  const lastCall = attempt.last_kb_call_ms ?? 0;
  if (nowMs() - lastCall < 30000) return; // wait for the 30-second window.
  if (attempt.state === "pending") {
    try {
      const outcome = await kb.purchase({ id: member.id, name: member.name, email: member.email }, txKey, attempt.amount_cents, 30000);
      if (outcome.result === "success") {
        await completePack(attempt, attempt.studio_id, attempt.member_id);
        await publish(pool, "credit", attempt.member_id, attempt.studio_id, { memberId: attempt.member_id });
      } else {
        await pool.query("UPDATE pack_attempts SET last_kb_call_ms = $1 WHERE id = $2", [nowMs(), attempt.id]);
      }
    } catch {
      await pool.query("UPDATE pack_attempts SET last_kb_call_ms = $1 WHERE id = $2", [nowMs(), attempt.id]);
    }
    return;
  }
  // held: release only on a lookup at least 30 seconds after its last call.
  await pool.query("UPDATE pack_attempts SET state = 'released' WHERE id = $1 AND state = 'held'", [attempt.id]);
}
