import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError, conflict } from "../errors";
import type { Ctx, Person, Studio } from "../http/context";
import { sendJson } from "../http/context";
import { balanceOf, memberEntries, postMovement } from "../billing/ledger";
import { entryBody, chargeBodyWithTitle } from "./bodies";
import { checkAmountCents, checkReason } from "./validate";
import { publish } from "../events";
import { refundCharge } from "../billing/refunds";
import type { ChargeRow } from "../types";

type MemberRow = { id: string; name: string; handle: string; email: string; membership: string | null; card_status: string; balance_cents: number; active: boolean };

async function memberRow(personId: string): Promise<MemberRow | null> {
  const p = await one<{ id: string; name: string; handle: string; email: string; membership: string | null; card_status: string; active: boolean }>(
    pool,
    "SELECT id, name, handle, email, membership, card_status, active FROM people WHERE id = $1 AND role = 'member'",
    [personId],
  );
  if (!p) return null;
  const balance = await balanceOf(pool, personId);
  return { ...p, balance_cents: balance };
}

function memberBody(m: MemberRow): Record<string, unknown> {
  return {
    id: m.id,
    name: m.name,
    handle: m.handle,
    email: m.email,
    membership: m.membership,
    card_status: m.card_status,
    balance_cents: m.balance_cents,
    active: m.active,
  };
}

export async function listMembers(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const search = ctx.query.get("q") ?? "";
  const like = `%${search.toLowerCase()}%`;
  const rows = await q<{ id: string }>(
    pool,
    `SELECT id FROM people WHERE studio_id = $1 AND role = 'member' AND (lower(name) LIKE $2 OR lower(handle) LIKE $2 OR lower(email) LIKE $2) ORDER BY name`,
    [studio.id, like],
  );
  const out = [];
  for (const r of rows) {
    const m = await memberRow(r.id);
    if (m) out.push(memberBody(m));
  }
  sendJson(ctx.res, 200, out);
}

async function memberForViewer(ctx: Ctx): Promise<MemberRow | null> {
  const studio = ctx.studio as Studio;
  const person = await one<{ id: string; studio_id: string; role: string }>(pool, "SELECT id, studio_id, role FROM people WHERE id = $1", [ctx.params.id]);
  // Only members and drop-off customers appear here; a tech or owner's id answers 404.
  if (!person || person.studio_id !== studio.id || person.role !== "member") throw new ApiError(404, "not_found", "Not found.");
  return memberRow(person.id);
}

export async function getMember(ctx: Ctx): Promise<void> {
  const member = await memberForViewer(ctx);
  if (!member) throw new ApiError(404, "not_found", "Not found.");
  const entries = await memberEntries(pool, member.id);
  const charges = await q<ChargeRow>(pool, "SELECT * FROM charges WHERE member_id = $1 ORDER BY created_at, id", [member.id]);
  const chargeBodies = [];
  for (const c of charges) chargeBodies.push(await chargeBodyWithTitle(pool, c));
  sendJson(ctx.res, 200, { ...memberBody(member), entries: entries.map(entryBody), charges: chargeBodies });
}

export async function deactivateMember(ctx: Ctx): Promise<void> {
  const member = await memberForViewer(ctx);
  if (!member) throw new ApiError(404, "not_found", "Not found.");
  const endedSessions: string[] = [];
  await tx(async (client) => {
    // Applied one after another with that member's credit movements and check-ins of
    // their pieces: the member money lock serializes the whole step.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.member(member.id)]);
    const sessions = await q<{ token: string }>(client, "SELECT token FROM sessions WHERE person_id = $1", [member.id]);
    for (const s of sessions) endedSessions.push(s.token);
    await client.query("DELETE FROM sessions WHERE person_id = $1", [member.id]);
    await client.query("UPDATE invites SET state = 'retired' WHERE studio_id = $1 AND lower(email) = $2 AND state = 'open'", [(ctx.studio as Studio).id, member.email.toLowerCase()]);
    await client.query("UPDATE people SET active = false WHERE id = $1", [member.id]);
  });
  const studio = ctx.studio as Studio;
  for (const token of endedSessions) {
    await publish(pool, "session", token, studio.id, { sessionId: token });
  }
  await publish(pool, "member", member.id, studio.id);
  const fresh = await memberRow(member.id);
  sendJson(ctx.res, 200, fresh ? memberBody(fresh) : {});
}

export async function reactivateMember(ctx: Ctx): Promise<void> {
  const member = await memberForViewer(ctx);
  if (!member) throw new ApiError(404, "not_found", "Not found.");
  await pool.query("UPDATE people SET active = true WHERE id = $1", [member.id]);
  await publish(pool, "member", member.id, (ctx.studio as Studio).id);
  const fresh = await memberRow(member.id);
  sendJson(ctx.res, 200, fresh ? memberBody(fresh) : {});
}

export async function postAdjustment(ctx: Ctx): Promise<void> {
  const member = await memberForViewer(ctx);
  if (!member) throw new ApiError(404, "not_found", "Not found.");
  const amount = checkAmountCents(ctx.body.amount_cents);
  const reason = checkReason(ctx.body.reason);
  const studio = ctx.studio as Studio;
  const { movementId, balanceCents } = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.member(member.id)]);
    return postMovement(client, {
      studioId: studio.id,
      memberId: member.id,
      kind: "adjustment",
      amountCents: amount,
      at: new Date(),
    });
  });
  await publish(pool, "member", member.id, studio.id);
  await publish(pool, "credit", member.id, studio.id, { memberId: member.id });
  sendJson(ctx.res, 201, { movement_id: movementId, balance_cents: balanceCents });
}

export async function refundChargeRoute(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const charge = await one<ChargeRow>(pool, "SELECT * FROM charges WHERE id = $1 AND studio_id = $2", [ctx.params.id, studio.id]);
  if (!charge) throw new ApiError(404, "not_found", "Not found.");
  const person = ctx.person as Person;
  if (person.role !== "owner") throw new ApiError(403, "forbidden", "Only the studio owner may do that.");
  checkReason(ctx.body.reason);
  const result = await refundCharge(charge);
  sendJson(ctx.res, result.status, result.body);
}
