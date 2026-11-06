import { randomUUID } from "node:crypto";
import { isUuid, requireRole } from "../access.ts";
import { auditDiagram, type DiagramAction } from "../audit.ts";
import { config } from "../config.ts";
import { many, one, pool, tx, type Db } from "../db.ts";
import { ApiError, notFound, sendEmpty, sendJson, validation } from "../http.ts";
import { deliverSoon, newInviteToken, queueMessage, type MessageKind } from "../mail.ts";
import { hashPassword } from "../passwords.ts";
import { route } from "../router.ts";
import { sha256 } from "../hash.ts";
import { issueSession } from "../sessions.ts";
import { hasControl, plainText } from "../validate.ts";

type StoredStatus = "invited" | "active" | "revoked" | "withdrawn";
type ShareRole = "editor" | "viewer";

interface ShareRow {
  id: string;
  diagram_id: string;
  email: string;
  role: ShareRole;
  status: StoredStatus;
  expires_at: Date | null;
  delivered: boolean;
  display_name: string | null;
}

/** Invited shares read `expired` once their link's time has passed, judged by server time at the request. */
function readStatus(row: Pick<ShareRow, "status" | "expires_at">): StoredStatus | "expired" {
  return row.status === "invited" && row.expires_at && row.expires_at.getTime() <= Date.now() ? "expired" : row.status;
}

function shareJson(row: ShareRow) {
  const status = readStatus(row);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status,
    delivery: row.delivered ? "sent" : "queued",
    expiresAt: status === "active" ? null : (row.expires_at?.toISOString() ?? null),
  };
}

const SHARE_COLUMNS = "s.id, s.diagram_id, s.email, s.role, s.status, s.expires_at, s.delivered, u.display_name";

async function shareOf(db: Db, diagramId: string, shareId: string, lock = false): Promise<ShareRow> {
  if (!isUuid(shareId)) throw notFound();
  const row = await one<ShareRow>(db, `SELECT ${SHARE_COLUMNS} FROM shares s LEFT JOIN users u ON u.email = s.email WHERE s.id = $1 AND s.diagram_id = $2${lock ? " FOR UPDATE OF s" : ""}`, [shareId, diagramId]);
  if (!row) throw notFound();
  return row;
}

/** A valid invitation email: one `@`, no whitespace or control character, at most 254 characters. */
function inviteEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || /\s/.test(email) || hasControl(email)) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) return null;
  return email;
}

const isRole = (v: unknown): v is ShareRole => v === "editor" || v === "viewer";

/* The share state machine: every transition, and every illegal edge, is decided here. */

type ShareAction = { kind: "accept" } | { kind: "replace" } | { kind: "role"; role: ShareRole } | { kind: "remove" };

interface Transition {
  status: StoredStatus;
  role: ShareRole;
  /** The audit event of a real transition; null when the action changes nothing. */
  audit: { action: DiagramAction; detail: Record<string, unknown> } | null;
  notice: Exclude<MessageKind, "invitation"> | null;
  /** The invitation's token dies and its queued mail is cancelled. */
  endsInvitation: boolean;
}

const shareEnded = () => new ApiError(409, "share_ended", "This share has already ended.");

/** A role change needs an active share; checked before the body is validated (state conflicts precede validation). */
function assertRoleChangeable(row: ShareRow): void {
  const status = readStatus(row);
  if (status === "revoked" || status === "withdrawn") throw shareEnded();
  if (status !== "active") throw new ApiError(409, "share_pending", "This invitation has not been accepted yet.");
}

/** `accept` and `replace` arrive only for a live or an expired invitation, which the lookup and the invite route establish. */
function transition(row: ShareRow, action: ShareAction): Transition {
  const unchanged: Transition = { status: row.status, role: row.role, audit: null, notice: null, endsInvitation: false };
  const { email } = row;
  switch (action.kind) {
    case "accept":
      return { ...unchanged, status: "active", endsInvitation: true, audit: { action: "share.accepted", detail: { email, role: row.role } } };
    case "replace":
      return { ...unchanged, status: "withdrawn", endsInvitation: true, audit: { action: "share.withdrawn", detail: { email } } };
    case "role":
      assertRoleChangeable(row);
      if (action.role === row.role) return unchanged;
      return {
        ...unchanged,
        role: action.role,
        audit: { action: "share.role_changed", detail: { email, from: row.role, to: action.role } },
        notice: action.role === "viewer" ? "downgrade" : null,
      };
    case "remove": {
      const status = readStatus(row);
      if (status === "revoked" || status === "withdrawn") throw shareEnded();
      if (status === "active") return { ...unchanged, status: "revoked", audit: { action: "share.revoked", detail: { email } }, notice: "revocation" };
      return { ...unchanged, status: "withdrawn", endsInvitation: true, audit: { action: "share.withdrawn", detail: { email } } };
    }
  }
}

/** Writes a transition, its audit event and its one queued notice in the caller's transaction; returns the notice's id. */
async function applyTransition(db: Db, row: ShareRow, change: Transition, actor: string): Promise<string | null> {
  if (!change.audit) return null;
  await db.query(
    "UPDATE shares SET status = $1, role = $2, token_seed = CASE WHEN $3 THEN NULL ELSE token_seed END WHERE id = $4",
    [change.status, change.role, change.endsInvitation, row.id],
  );
  if (change.endsInvitation) await db.query("UPDATE messages SET status = 'cancelled' WHERE share_id = $1 AND status = 'queued'", [row.id]);
  await auditDiagram(db, row.diagram_id, actor, change.audit.action, change.audit.detail);
  return change.notice ? queueMessage(db, change.notice, row.id, row.diagram_id, row.email) : null;
}

route("GET", "/api/diagrams/{id}/shares", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "owner");
  const rows = await many<ShareRow>(pool, `SELECT ${SHARE_COLUMNS} FROM shares s LEFT JOIN users u ON u.email = s.email WHERE s.diagram_id = $1 AND s.status IN ('invited', 'active') ORDER BY s.created_at, s.id`, [params.id]);
  sendJson(res, 200, { shares: rows.map(shareJson) });
});

route("POST", "/api/diagrams/{id}/shares", { auth: "session" }, async (ctx) => {
  const { user } = ctx.session;
  const diagramId = ctx.params.id;
  const result = await tx(async (db) => {
    await requireRole(db, diagramId, user, "owner", true);
    const window = await one<{ n: string; oldest: Date | null }>(
      db,
      "SELECT count(*) AS n, min(invited_at) AS oldest FROM shares WHERE diagram_id = $1 AND invited_at > now() - make_interval(secs => $2)",
      [diagramId, config.timers.inviteRateWindow],
    );
    if (Number(window?.n ?? 0) >= 20 && window?.oldest) {
      const wait = Math.max(1, Math.ceil((window.oldest.getTime() + config.timers.inviteRateWindow * 1000 - Date.now()) / 1000));
      throw new ApiError(429, "invite_rate_limited", "Too many invitations sent. Try again later.", undefined, { "Retry-After": String(wait) });
    }
    const body = ctx.body();
    const email = inviteEmail(body.email);
    if (email !== null) {
      const owner = await one<{ email: string }>(db, "SELECT u.email FROM diagrams d JOIN users u ON u.id = d.owner_id WHERE d.id = $1", [diagramId]);
      const open = await many<ShareRow>(db, `SELECT ${SHARE_COLUMNS} FROM shares s LEFT JOIN users u ON u.email = s.email WHERE s.diagram_id = $1 AND s.email = $2 AND s.status IN ('invited', 'active')`, [diagramId, email]);
      if (owner?.email === email || open.some((s) => s.status === "active")) throw new ApiError(409, "already_member", "This person already has access.");
      if (open.some((s) => readStatus(s) === "invited")) throw new ApiError(409, "invite_pending", "An invitation to this email is already pending.");
      for (const expired of open) await applyTransition(db, expired, transition(expired, { kind: "replace" }), user.email);
    }
    const fields: Record<string, string> = {};
    if (email === null) fields.email = "invalid";
    if (!isRole(body.role)) fields.role = "invalid";
    if (email === null || !isRole(body.role)) throw validation(fields);
    const id = randomUUID();
    const invite = newInviteToken();
    await db.query(
      `INSERT INTO shares (id, diagram_id, email, role, status, token_seed, token_hash, expires_at, invited_at)
       VALUES ($1, $2, $3, $4, 'invited', $5, $6, now() + make_interval(secs => $7), now())`,
      [id, diagramId, email, body.role, invite.seed, sha256(invite.token), config.timers.inviteTtl],
    );
    const messageId = await queueMessage(db, "invitation", id, diagramId, email);
    await auditDiagram(db, diagramId, user.email, "share.invited", { email, role: body.role });
    return { share: await shareOf(db, diagramId, id), messageId };
  });
  deliverSoon(result.messageId);
  sendJson(ctx.res, 201, { share: shareJson(result.share) });
});


route("PATCH", "/api/diagrams/{id}/shares/{shareId}", { auth: "session" }, async (ctx) => {
  const { user } = ctx.session;
  const result = await tx(async (db) => {
    await requireRole(db, ctx.params.id, user, "owner");
    const row = await shareOf(db, ctx.params.id, ctx.params.shareId, true);
    assertRoleChangeable(row);
    const role = ctx.body().role;
    if (!isRole(role)) throw validation({ role: "invalid" });
    const messageId = await applyTransition(db, row, transition(row, { kind: "role", role }), user.email);
    return { share: await shareOf(db, ctx.params.id, row.id), messageId };
  });
  if (result.messageId) deliverSoon(result.messageId);
  sendJson(ctx.res, 200, { share: shareJson(result.share) });
});

route("DELETE", "/api/diagrams/{id}/shares/{shareId}", { auth: "session" }, async ({ res, session, params }) => {
  const messageId = await tx(async (db) => {
    await requireRole(db, params.id, session.user, "owner");
    const row = await shareOf(db, params.id, params.shareId, true);
    return applyTransition(db, row, transition(row, { kind: "remove" }), session.user.email);
  });
  if (messageId) deliverSoon(messageId);
  sendEmpty(res, 204);
});

/* Invitations */

interface InviteRow extends ShareRow {
  title: string;
  inviter: string;
  first_page_id: string;
  account_id: string | null;
}

async function failedLookups(db: Db, ip: string): Promise<void> {
  const row = await one<{ n: string; oldest: Date | null }>(
    db,
    "SELECT count(*) AS n, min(at) AS oldest FROM invite_lookup_failures WHERE ip = $1 AND at > now() - make_interval(secs => $2)",
    [ip, config.timers.inviteLookupWindow],
  );
  if (Number(row?.n ?? 0) >= 20 && row?.oldest) {
    const wait = Math.max(1, Math.ceil((row.oldest.getTime() + config.timers.inviteLookupWindow * 1000 - Date.now()) / 1000));
    throw new ApiError(429, "invite_lookup_limited", "Too many attempts. Wait a few minutes and open the link again.", undefined, { "Retry-After": String(wait) });
  }
}

/** Looks a token up after the failed-lookup limit; a 404 or 410 counts as a failed lookup for the IP. */
async function lookupInvite(db: Db, token: string, ip: string, lock: boolean): Promise<InviteRow> {
  await failedLookups(pool, ip);
  const row = /^[A-Za-z0-9_-]{16,128}$/.test(token)
    ? await one<InviteRow>(
      db,
      `SELECT ${SHARE_COLUMNS}, d.title, o.display_name AS inviter, u.id AS account_id,
              (SELECT p.id FROM pages p WHERE p.diagram_id = d.id ORDER BY p.seq LIMIT 1) AS first_page_id
         FROM shares s JOIN diagrams d ON d.id = s.diagram_id AND d.deleted_at IS NULL
         JOIN users o ON o.id = d.owner_id LEFT JOIN users u ON u.email = s.email
        WHERE s.token_hash = $1 AND s.status = 'invited'${lock ? " FOR UPDATE OF s" : ""}`,
      [sha256(token)],
    )
    : undefined;
  const expired = row && readStatus(row) === "expired";
  if (!row || expired) {
    await pool.query("INSERT INTO invite_lookup_failures (ip, at) VALUES ($1, now())", [ip]);
    if (expired) throw new ApiError(410, "invite_expired", "This invitation has expired.");
    throw notFound();
  }
  return row;
}

route("GET", "/api/invites/{token}", { auth: "none" }, async ({ res, params, ip }) => {
  const row = await lookupInvite(pool, params.token, ip, false);
  sendJson(res, 200, { invite: { diagramTitle: row.title, inviterName: row.inviter, role: row.role, email: row.email, accountExists: row.account_id !== null } });
});

route("POST", "/api/invites/{token}/accept", { auth: "optional" }, async (ctx) => {
  const signedIn = ctx.session;
  const { result, cookie } = await tx(async (db) => {
    const row = await lookupInvite(db, ctx.params.token, ctx.ip, true);
    let accountId: string;
    let cookie: string | null = null;
    if (signedIn) {
      if (signedIn.user.email !== row.email) throw new ApiError(403, "invite_email_mismatch", "This invitation was sent to a different email address.");
      accountId = signedIn.user.id;
    } else {
      if (row.account_id) throw new ApiError(401, "unauthenticated", "Sign in to accept this invitation.");
      const body = ctx.body();
      const displayName = plainText(body.displayName, 80);
      const password = typeof body.password === "string" ? body.password : "";
      const length = Array.from(password).length;
      const fields: Record<string, string> = {};
      if (displayName === null) fields.displayName = "invalid";
      if (length < 12 || length > 128) fields.password = "length";
      if (Object.keys(fields).length) throw validation(fields);
      accountId = randomUUID();
      await db.query("INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)", [accountId, row.email, displayName, await hashPassword(password)]);
      cookie = (await issueSession(db, ctx.req, accountId)).cookie;
    }
    await applyTransition(db, row, transition(row, { kind: "accept" }), row.email);
    await db.query("UPDATE shares SET user_id = $1, delivered = true WHERE id = $2", [accountId, row.id]);
    return { result: { diagramId: row.diagram_id, firstPageId: row.first_page_id, role: row.role }, cookie };
  });
  sendJson(ctx.res, 200, result, cookie ? { "Set-Cookie": cookie } : {});
});
