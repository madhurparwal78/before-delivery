import { randomBytes, randomUUID } from "node:crypto";
import { ALERTS, FIELD_ERRORS, INVITATION_SENTENCES } from "../shared/copy.js";
import { bulletLabel } from "../shared/text.js";
import type { ShareRow, ShareStatus } from "../shared/types.js";
import { config } from "./config.js";
import { pool, tx } from "./db.js";
import { isEmail, normalizeEmail } from "./accounts.js";
import { ownerOfBullet } from "./commit.js";
import { conflict, invalid, notFound, type JsonObject, type Session } from "./http.js";
import { announceRevocation } from "./live.js";
import { invitationMail, MailError, sendMail } from "./mail.js";

type Event = "mail_accepted" | "mail_refused" | "retry" | "accept" | "expire" | "revoke";

const TRANSITIONS: Record<ShareStatus, Partial<Record<Event, ShareStatus>>> = {
  pending_send: { mail_accepted: "sent", mail_refused: "not_sent" },
  not_sent: { retry: "pending_send", expire: "lapsed", revoke: "revoked" },
  sent: { accept: "accepted", expire: "lapsed", revoke: "revoked" },
  accepted: { revoke: "revoked" },
  lapsed: {},
  revoked: {},
};

/** The one place an invitation changes state. */
function transition(from: ShareStatus, event: Event): ShareStatus | null {
  return TRANSITIONS[from][event] ?? null;
}

const OPEN: readonly ShareStatus[] = ["pending_send", "sent", "not_sent", "accepted"];

interface ShareRecord {
  id: string;
  owner_id: string;
  bullet_id: string;
  email: string;
  token: string;
  status: ShareStatus;
  created_at: Date;
  aged: boolean;
  inviter: string;
}

interface Share {
  id: string;
  ownerId: string;
  bulletId: string;
  email: string;
  token: string;
  status: ShareStatus;
  createdAt: Date;
  inviter: string;
}

const SELECT = `SELECT s.id, s.owner_id, s.bullet_id, s.email, s.token, s.status, s.created_at,
  s.created_at + $1 * interval '1 second' <= now() AS aged, o.name AS inviter
  FROM shares s JOIN accounts o ON o.id = s.owner_id`;

function toShare(record: ShareRecord): Share {
  const lapsed = record.aged ? transition(record.status, "expire") : null;
  return {
    id: record.id, ownerId: record.owner_id, bulletId: record.bullet_id, email: record.email, token: record.token,
    status: lapsed ?? record.status, createdAt: record.created_at, inviter: record.inviter,
  };
}

async function find(where: string, value: string): Promise<Share | null> {
  const found = await pool.query<ShareRecord>(`${SELECT} WHERE ${where}`, [config.inviteTtlSeconds, value]);
  const record = found.rows[0];
  return record === undefined ? null : toShare(record);
}

const publicShare = (share: Share): ShareRow => ({
  id: share.id, email: share.email, status: share.status, createdAt: share.createdAt.toISOString(),
});

async function setStatus(id: string, status: ShareStatus): Promise<void> {
  await pool.query("UPDATE shares SET status = $2 WHERE id = $1", [id, status]);
}

/** Moves a share from one status to another only if it is still in the first: the loser of a race gets false. */
async function moveStatus(id: string, from: ShareStatus, to: ShareStatus): Promise<boolean> {
  const moved = await pool.query("UPDATE shares SET status = $3 WHERE id = $1 AND status = $2", [id, from, to]);
  return moved.rowCount === 1;
}

async function branchTextFor(ownerId: string, bulletId: string): Promise<string> {
  const found = await pool.query<{ text: string; original: string | null; mirrored: boolean }>(
    `SELECT b.text, o.text AS original, b.mirror_of IS NOT NULL AS mirrored FROM bullets b
     LEFT JOIN bullets o ON o.id = b.mirror_of AND o.trashed_at IS NULL
     WHERE b.id = $1 AND b.owner_id = $2 AND b.trashed_at IS NULL AND (b.purge_at IS NULL OR b.purge_at > now())`,
    [bulletId, ownerId],
  );
  const row = found.rows[0];
  if (row === undefined) throw notFound();
  return row.mirrored ? row.original ?? "" : row.text;
}

async function deliver(share: Share, inviter: string, text: string): Promise<ShareStatus> {
  let event: Event = "mail_accepted";
  try {
    const mail = invitationMail(inviter, bulletLabel(text), share.token);
    await sendMail(share.email, mail.subject, mail.body);
  } catch (error) {
    if (!(error instanceof MailError)) throw error;
    event = "mail_refused";
  }
  const next = transition("pending_send", event) ?? "not_sent";
  await setStatus(share.id, next);
  return next;
}

async function ownedBy(actor: Session, shareId: string): Promise<Share> {
  const share = await find("s.id = $2", shareId);
  if (share === null || share.ownerId !== actor.accountId) throw notFound();
  return share;
}

export async function listShares(actor: Session, bulletId: string): Promise<ShareRow[]> {
  if ((await ownerOfBullet(bulletId)) !== actor.accountId) throw notFound();
  await branchTextFor(actor.accountId, bulletId);
  const found = await pool.query<ShareRecord>(
    `${SELECT} WHERE s.bullet_id = $2 AND s.status <> 'revoked' ORDER BY s.created_at, s.id`,
    [config.inviteTtlSeconds, bulletId],
  );
  return found.rows.map((record) => publicShare(toShare(record)));
}

export async function invite(actor: Session, bulletId: string, body: JsonObject): Promise<ShareRow> {
  if ((await ownerOfBullet(bulletId)) !== actor.accountId) throw notFound();
  const text = await branchTextFor(actor.accountId, bulletId);
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!isEmail(email)) throw invalid({ email: FIELD_ERRORS.email });
  if (email === actor.email) throw invalid({ email: FIELD_ERRORS.selfInvite });
  const share: Share = {
    id: randomUUID(), ownerId: actor.accountId, bulletId, email, token: randomBytes(32).toString("base64url"),
    status: "pending_send", createdAt: new Date(), inviter: actor.name,
  };
  // One invitation per address and bullet at a time: the check and the insert hold one lock, so a race makes one share.
  const stored = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 2))", [`invite:${bulletId}:${email}`]);
    const existing = await client.query<ShareRecord>(`${SELECT} WHERE s.bullet_id = $2 AND s.email = $3`, [
      config.inviteTtlSeconds, bulletId, email,
    ]);
    const open = existing.rows.map(toShare).some((found) => OPEN.includes(found.status));
    if (open) throw conflict("already_invited", FIELD_ERRORS.alreadyInvited);
    return client.query<{ created_at: Date }>(
      "INSERT INTO shares (id, owner_id, bullet_id, email, token, status) VALUES ($1, $2, $3, $4, $5, 'pending_send') RETURNING created_at",
      [share.id, share.ownerId, bulletId, email, share.token],
    );
  });
  const status = await deliver(share, actor.name, text);
  return publicShare({ ...share, status, createdAt: stored.rows[0]?.created_at ?? share.createdAt });
}

export async function retryShare(actor: Session, shareId: string): Promise<ShareRow> {
  const share = await ownedBy(actor, shareId);
  const next = transition(share.status, "retry");
  if (next === null) throw conflict("not_retryable", ALERTS.notRetryable);
  const text = await branchTextFor(actor.accountId, share.bulletId);
  if (!(await moveStatus(share.id, share.status, next))) throw conflict("not_retryable", ALERTS.notRetryable);
  const status = await deliver(share, actor.name, text);
  return publicShare({ ...share, status });
}

export async function revokeShare(actor: Session, shareId: string): Promise<ShareRow> {
  const share = await ownedBy(actor, shareId);
  const next = transition(share.status, "revoke");
  if (next === null) throw conflict("share_closed", ALERTS.shareClosed);
  if (!(await moveStatus(share.id, share.status, next))) throw conflict("share_closed", ALERTS.shareClosed);
  await announceRevocation(share.ownerId, share.bulletId);
  return publicShare({ ...share, status: next });
}

async function liveInvitation(token: string): Promise<Share> {
  const share = await find("s.token = $2", token);
  if (share === null || share.status === "revoked") throw notFound();
  await branchTextFor(share.ownerId, share.bulletId);
  return share;
}

export async function readInvitation(token: string) {
  const share = await liveInvitation(token);
  const text = await branchTextFor(share.ownerId, share.bulletId);
  return { email: share.email, bulletText: bulletLabel(text), inviter: { name: share.inviter }, status: share.status };
}

export async function acceptInvitation(actor: Session, token: string): Promise<{ bulletId: string }> {
  const share = await liveInvitation(token);
  if (share.email !== actor.email) throw conflict("wrong_account", INVITATION_SENTENCES.wrongAccount);
  if (share.status === "lapsed") throw conflict("invitation_lapsed", INVITATION_SENTENCES.lapsed);
  if (share.status === "accepted") return { bulletId: share.bulletId };
  const next = transition(share.status, "accept");
  if (next === null) throw notFound();
  await pool.query("UPDATE shares SET status = $2, account_id = $3 WHERE id = $1", [share.id, next, actor.accountId]);
  return { bulletId: share.bulletId };
}
