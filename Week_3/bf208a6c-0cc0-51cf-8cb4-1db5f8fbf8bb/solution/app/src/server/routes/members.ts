import { authorize, callerOf, open } from "../access";
import { config } from "../config";
import { maybeOne, one, pool, rows } from "../db";
import { writeBoard } from "../events";
import { ApiError, empty, invalid, isUuid, json, notFound, param, parseJson, serviceDown, signInRequired, text, type Reply, type Request } from "../http";
import { newToken } from "../security";
import { MailError, send } from "../services/mail";
import { strongest } from "../../shared/permissions";
import { MESSAGES, emailOnBoardMessage, looksLikeEmail } from "../../shared/rules";
import { INVITABLE_ROLES, isOneOf, type InviteInfo, type Member, type Role } from "../../shared/types";

const MEMBER_QUERY = `SELECT m.user_id, u.display_name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.board_id = $1`;

export async function list(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  authorize(access, "manage");
  const members = await rows<Member>(pool, `${MEMBER_QUERY} ORDER BY (m.role = 'owner') DESC, m.joined_at, m.user_id`, [access.board.id]);
  return json(200, { members });
}

async function targetMember(boardId: string, userId: string, ownerId: string): Promise<void> {
  if (userId === ownerId) throw invalid({ role: MESSAGES.ownerRole });
  const found = isUuid(userId) ? await maybeOne(pool, `SELECT 1 FROM members WHERE board_id = $1 AND user_id = $2`, [boardId, userId]) : null;
  if (!found) throw notFound();
}

const CHOOSE_ROLE = "Choose Viewer, Contributor or Moderator.";

export async function changeRole(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  authorize(access, "manage");
  const userId = param(request, "userId");
  await targetMember(access.board.id, userId, access.board.owner_id);
  const role = parseJson(request.body)["role"];
  if (!isOneOf(INVITABLE_ROLES, role)) throw invalid({ role: CHOOSE_ROLE });
  const member = await writeBoard(access.board.id, async ({ db, emit, accessChanged }) => {
    await db.query(`UPDATE members SET role = $3 WHERE board_id = $1 AND user_id = $2`, [access.board.id, userId, role]);
    accessChanged();
    await emit({ type: "role_changed", role }, { scope: "user", userId });
    await emit({ type: "members_changed" }, { scope: "user", userId: access.board.owner_id });
    return one<Member>(db, `${MEMBER_QUERY} AND m.user_id = $2`, [access.board.id, userId]);
  });
  return json(200, member);
}

export async function remove(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  authorize(access, "manage");
  const userId = param(request, "userId");
  await targetMember(access.board.id, userId, access.board.owner_id);
  await writeBoard(access.board.id, async ({ db, emit, accessChanged }) => {
    await db.query(`DELETE FROM members WHERE board_id = $1 AND user_id = $2`, [access.board.id, userId]);
    accessChanged();
    await emit({ type: "role_changed", role: null }, { scope: "user", userId });
    await emit({ type: "members_changed" }, { scope: "user", userId: access.board.owner_id });
  });
  return empty(204);
}

export async function invite(request: Request): Promise<Reply> {
  const access = await open(request, { boardId: param(request, "id") });
  const inviter = authorize(access, "manage");
  const body = parseJson(request.body);
  const email = text(body["email"]).trim();
  const role = body["role"];
  const errors: Record<string, string> = {};
  if (!looksLikeEmail(email)) errors["email"] = MESSAGES.email;
  else if (await maybeOne(pool, `SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.board_id = $1 AND lower(u.email) = lower($2)`, [access.board.id, email])) {
    errors["email"] = emailOnBoardMessage(email);
  }
  if (!isOneOf(INVITABLE_ROLES, role)) errors["role"] = CHOOSE_ROLE;
  if (Object.keys(errors).length || !isOneOf(INVITABLE_ROLES, role)) throw invalid(errors);
  const token = newToken();
  try {
    await send({
      to: email,
      subject: `${inviter.display_name} invited you to ${access.board.title} on Pinsheet`,
      text: `${inviter.display_name} invited you to ${access.board.title} as a ${role}. Open ${config.publicUrl}/invite/${token} to join.`,
    });
  } catch (error) {
    if (error instanceof MailError) throw serviceDown("mail_unavailable");
    throw error;
  }
  const stored = await one<{ created_at: Date }>(pool, `INSERT INTO invites (token, board_id, inviter_id, email, role) VALUES ($1, $2, $3, $4, $5) RETURNING created_at`, [token, access.board.id, inviter.id, email, role]);
  const expires = new Date(stored.created_at.getTime() + config.inviteTtlSeconds * 1000);
  return json(201, { invite: { email, role, expires_at: expires.toISOString() } });
}

/** An invite is spent once used or older than INVITE_TTL_SECONDS (`$2`). */
const EXPIRED = `(i.used_at IS NOT NULL OR i.created_at + make_interval(secs => $2) < now())`;

const INVITE_QUERY = `
  SELECT i.token, i.board_id, b.owner_id, i.role, b.title AS board_title, u.display_name AS inviter_name, ${EXPIRED} AS expired
  FROM invites i JOIN boards b ON b.id = i.board_id JOIN users u ON u.id = i.inviter_id WHERE i.token = $1`;

interface InviteRow extends InviteInfo {
  board_id: string;
  owner_id: string;
}

export async function inviteInfo(request: Request): Promise<Reply> {
  const found = await maybeOne<InviteRow>(pool, INVITE_QUERY, [param(request, "token"), config.inviteTtlSeconds]);
  if (!found) throw notFound();
  const { board_title, inviter_name, role, expired } = found;
  return json(200, { board_title, inviter_name, role, expired });
}

export async function accept(request: Request): Promise<Reply> {
  const token = param(request, "token");
  const found = await maybeOne<InviteRow>(pool, INVITE_QUERY, [token, config.inviteTtlSeconds]);
  if (!found) throw notFound();
  const { user } = await callerOf(request);
  if (!user) throw signInRequired();
  const role = await writeBoard(found.board_id, async ({ db, emit, accessChanged }) => {
    const used = await db.query(`UPDATE invites i SET used_at = now() WHERE i.token = $1 AND NOT ${EXPIRED}`, [token, config.inviteTtlSeconds]);
    if (used.rowCount !== 1) throw new ApiError(410, { error: "invite_expired" });
    const held = await maybeOne<{ role: Role }>(db, `SELECT role FROM members WHERE board_id = $1 AND user_id = $2`, [found.board_id, user.id]);
    const joined = strongest(held?.role ?? null, found.role);
    await db.query(`INSERT INTO members (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [found.board_id, user.id, joined]);
    accessChanged();
    await emit({ type: "role_changed", role: joined }, { scope: "user", userId: user.id });
    await emit({ type: "members_changed" }, { scope: "user", userId: found.owner_id });
    return joined;
  });
  return json(200, { board_id: found.board_id, role });
}
