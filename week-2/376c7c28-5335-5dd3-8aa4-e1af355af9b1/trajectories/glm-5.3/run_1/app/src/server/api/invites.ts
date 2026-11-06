import { newId, config } from "../config";
import { now } from "../clock";
import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError, conflict } from "../errors";
import { newInviteToken, hashPassword } from "../auth";
import { sendMail } from "../services/mailer";
import type { Ctx } from "../http/context";
import { sendJson, setCookie } from "../http/context";
import { newSessionToken } from "../auth";
import { checkEmail, checkHandle, checkName, checkPassword, checkMembership, checkRole } from "./validate";
import { publish } from "../events";
import type { Person, Studio } from "../http/context";

type InviteRow = {
  id: string;
  studio_id: string;
  email: string;
  role: "kiln_tech" | "member";
  membership: "member" | "drop_off" | null;
  token: string;
  expires_at: Date;
  state: "open" | "used" | "retired";
};

export async function postInvite(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const email = checkEmail(ctx.body.email);
  const role = checkRole(ctx.body.role);
  let membership: "member" | "drop_off" | null = null;
  if (role === "member") {
    membership = checkMembership(ctx.body.membership);
  }
  const invite: InviteRow = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.invite(studio.id, email)]);
    // An inactive member's email cannot be invited; anyone else already in the studio is taken.
    const existing = await one<{ id: string; role: string; active: boolean }>(client, "SELECT id, role, active FROM people WHERE studio_id = $1 AND lower(email) = $2", [studio.id, email]);
    if (existing) {
      if (existing.role === "member" && !existing.active) throw conflict("member_inactive", `${email} is not active in this studio. Reactivate them first.`);
      throw conflict("already_member", `${email} is already in this studio.`);
    }
    // Retire every earlier unused token for this studio and email in the same step.
    await client.query("UPDATE invites SET state = 'retired' WHERE studio_id = $1 AND lower(email) = $2 AND state = 'open'", [studio.id, email]);
    const id = newId();
    const token = newInviteToken();
    const expires = new Date(now().getTime() + config.inviteTtlSeconds * 1000);
    const rows = await q<InviteRow>(
      client,
      `INSERT INTO invites (id, studio_id, email, role, membership, token, expires_at, state, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8) RETURNING *`,
      [id, studio.id, email, role, membership, token, expires, now()],
    );
    return rows[0] as InviteRow;
  });
  const host = ctx.req.headers.host ?? "localhost";
  const link = `http://${host}/invite/${invite.token}`;
  void sendMail(email, `Join ${studio.name} on Kiln Desk`, `${studio.name} has invited you to join Kiln Desk.\nOpen this link to join:\n${link}\n`).catch(() => {});
  await publish(pool, "invite", invite.id, studio.id);
  sendJson(ctx.res, 201, { id: invite.id, email: invite.email, role: invite.role, membership: invite.membership, expires_at: invite.expires_at });
}

async function findInvite(token: string): Promise<InviteRow> {
  const invite = await one<InviteRow>(pool, "SELECT * FROM invites WHERE token = $1", [token]);
  if (!invite) throw new ApiError(404, "not_found", "This invite link is not valid.");
  if (invite.state !== "open" || now() > invite.expires_at) {
    throw new ApiError(410, "invite_gone", "This invite has expired or was already used.");
  }
  return invite as InviteRow;
}

export async function getInvite(ctx: Ctx): Promise<void> {
  const invite = await findInvite(ctx.params.token);
  const studio = await one<Studio>(pool, "SELECT * FROM studios WHERE id = $1", [invite.studio_id]);
  sendJson(ctx.res, 200, { studio_name: studio?.name ?? "", email: invite.email, role: invite.role });
}

export async function acceptInvite(ctx: Ctx): Promise<void> {
  const invite = await findInvite(ctx.params.token);
  const name = checkName(ctx.body.name);
  const handle = checkHandle(ctx.body.handle);
  const password = checkPassword(ctx.body.password);
  const result = await tx(async (client): Promise<{ kind: "gone"; person?: Person; token?: string } | { kind: "handle_taken" } | { kind: "ok"; person: Person; token: string }> => {
    // Exactly one accept per token wins; every other one answers invite_gone.
    const claimed = await one<{ id: string }>(
      client,
      "UPDATE invites SET state = 'used' WHERE token = $1 AND state = 'open' RETURNING id",
      [invite.token],
    );
    if (!claimed) return { kind: "gone" as const, person: undefined as unknown as Person, token: "" };
    const id = newId();
    const person = await one<{ id: string; studio_id: string; email: string; name: string; handle: string; role: string; membership: string | null; card_status: string; active: boolean }>(
      client,
      `INSERT INTO people (id, studio_id, email, name, handle, role, membership, card_status, password_hash, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'none',$8,true,$9)
       ON CONFLICT (studio_id, handle) DO NOTHING
       RETURNING id, studio_id, email, name, handle, role, membership, card_status, active`,
      [id, invite.studio_id, invite.email, name, handle, invite.role, invite.membership, hashPassword(password), now()],
    );
    if (!person) return { kind: "handle_taken" as const };
    const token = newSessionToken();
    await client.query("INSERT INTO sessions (token, person_id, studio_id, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)", [
      token,
      person!.id,
      invite.studio_id,
      new Date(now().getTime() + config.sessionTtlSeconds * 1000),
      now(),
    ]);
    return { kind: "ok" as const, person: person as unknown as Person, token };
  });
  if (result.kind === "gone") throw new ApiError(410, "invite_gone", "This invite has expired or was already used.");
  if (result.kind === "handle_taken") {
    const { validation, fieldMsg } = await import("../errors");
    throw validation({ handle: fieldMsg.handleTaken });
  }
  const studio = await one<Studio>(pool, "SELECT * FROM studios WHERE id = $1", [invite.studio_id]);
  setCookie(ctx.res, "kd_session", result.token, { secure: (ctx.req.socket as { encrypted?: boolean }).encrypted === true });
  await publish(pool, "member", result.person.id, invite.studio_id);
  sendJson(ctx.res, 201, {
    user: {
      id: result.person.id,
      name: result.person.name,
      handle: (result.person as Person).handle,
      role: result.person.role,
      studio: { slug: studio?.slug ?? "", name: studio?.name ?? "", time_zone: studio?.time_zone ?? "" },
    },
  });
}
