// Review rooms: invitations, comments pinned to a view, approvals that follow the head's geometry.
import type { CommentJson, RoomJson } from "../shared/api";
import type { Json } from "../shared/canonical";
import { TITLE_MAX, boundedMessage, boundedText, foldEmail, graphemeCount, normalizeText } from "../shared/text";
import { volumeText } from "../shared/numbers";
import type { Pose, Vec3 } from "../shared/tine";
import { isEmail, type User } from "./auth";
import { config } from "./config";
import { db, transaction, type Queries, type Tx } from "./db";
import { ApiError, MailUnavailable, forbidden, invalid, notFound } from "./errors";
import { emit } from "./events";
import type { Ctx } from "./http";
import { get, post, type Route } from "./route";
import { idempotent } from "./idempotency";
import { newId } from "./ids";
import { sendMail } from "./mail";
import { headRevision, isReviewer, loadPart, loadRevision, requirePart, readablePart, revisionLabel } from "./records";
import { jsonReply } from "./reply";

interface RoomSql {
  id: string;
  part_slug: string;
  base_revision_id: string;
  owner_id: string;
  title: string;
  closed: boolean;
  created_at: Date;
}

const roomClosed = () => new ApiError(409, "room_closed", "This review room is closed.");

/** The room as the API shows it: its state and approvals follow the head's digest (house rule H6). */
export async function roomJson(queries: Queries, roomId: string): Promise<RoomJson> {
  const room = await queries.one<RoomSql>("SELECT * FROM rooms WHERE id = $1", [roomId]);
  const head = await headRevision(queries, room.part_slug);
  const approvals = await queries.rows<{ reviewer_id: string; revision_id: string; geometry_digest: string; at: Date }>(
    `SELECT reviewer_id, revision_id, geometry_digest, at FROM approvals
      WHERE room_id = $1 AND geometry_digest = $2 ORDER BY at, reviewer_id COLLATE "C"`,
    [roomId, head.geometry_digest],
  );
  const reviewers = await queries.rows<{ email: string; id: string | null; display_name: string | null }>(
    `SELECT rr.email, u.id, u.display_name FROM room_reviewers rr
       LEFT JOIN users u ON u.email_fold = rr.email_fold AND u.verified
      WHERE rr.room_id = $1 ORDER BY rr.email_fold`,
    [roomId],
  );
  const state = room.closed ? "closed" : approvals.length >= config.requiredApprovals ? "approved" : "open";
  return {
    id: room.id,
    partSlug: room.part_slug,
    baseRevisionId: room.base_revision_id,
    headRevisionId: head.id,
    title: room.title,
    state,
    requiredApprovals: config.requiredApprovals,
    approvals: approvals.map((a) => ({ reviewerId: a.reviewer_id, revisionId: a.revision_id, geometryDigest: a.geometry_digest, at: a.at.toISOString() })),
    reviewers: reviewers.map((r) => ({ email: r.email, userId: r.id, displayName: r.display_name })),
    createdBy: room.owner_id,
  };
}

async function countApprovals(tx: Tx, roomId: string, digest: string | null): Promise<number> {
  const row = await tx.row<{ n: number }>("SELECT count(*)::int AS n FROM approvals WHERE room_id = $1 AND geometry_digest = $2", [roomId, digest]);
  return row?.n ?? 0;
}

/** What a new head does to the approvals of every open room, written in the revision's own transaction. */
export async function applyRoomEffects(tx: Tx, slug: string, previousDigest: string | null, digest: string, headLabel: string): Promise<void> {
  const rooms = await tx.rows<{ id: string }>("SELECT id FROM rooms WHERE part_slug = $1 AND NOT closed ORDER BY created_at, id", [slug]);
  for (const { id } of rooms) {
    const before = await countApprovals(tx, id, previousDigest);
    const after = await countApprovals(tx, id, digest);
    const reason = previousDigest === digest ? "carried" : after > 0 ? "matched" : before > 0 ? "reset" : null;
    if (reason) await emit(tx, slug, "approvals", id, { type: "approvals", room: await roomJson(tx, id), reason, label: headLabel, displayName: null });
  }
}

// ------------------------------------------------------------------------------------------------ comments

interface CommentSql {
  id: string;
  room_id: string;
  author_id: string;
  display_name: string;
  body: string;
  anchor: CommentJson["anchor"];
  pose: Pose;
  revision_id: string;
  created_at: Date;
}

const COMMENTS = "SELECT c.*, u.display_name FROM comments c JOIN users u ON u.id = c.author_id";

function commentFromRow(c: CommentSql): CommentJson {
  return { id: c.id, roomId: c.room_id, author: { id: c.author_id, displayName: c.display_name }, body: c.body, anchor: c.anchor, pose: c.pose, revisionId: c.revision_id, createdAt: c.created_at.toISOString() };
}

const isVec3 = (value: Json | undefined): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number");

export function parseAnchor(raw: Json | undefined): CommentJson["anchor"] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  if (raw.kind === "none") return { kind: "none" };
  return raw.kind === "point" && isVec3(raw.position) ? { kind: "point", position: raw.position } : null;
}

export function parsePose(raw: Json | undefined): Pose | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { position, target, up, fov } = raw;
  return isVec3(position) && isVec3(target) && isVec3(up) && typeof fov === "number" ? { position, target, up, fov } : null;
}

interface NewComment {
  roomId: string;
  authorId: string;
  body: string;
  anchor: CommentJson["anchor"];
  pose: Pose;
  createdAt: Date;
}

async function assertOpen(queries: Queries, roomId: string): Promise<void> {
  const room = await queries.row<{ closed: boolean }>("SELECT closed FROM rooms WHERE id = $1", [roomId]);
  if (room?.closed) throw roomClosed();
}

export async function insertComment(comment: NewComment): Promise<CommentJson> {
  return transaction(async (tx) => {
    const room = await tx.one<{ part_slug: string }>("SELECT part_slug FROM rooms WHERE id = $1", [comment.roomId]);
    await tx.run("SELECT 1 FROM parts WHERE slug = $1 FOR UPDATE", [room.part_slug]);
    await assertOpen(tx, comment.roomId);
    const head = await headRevision(tx, room.part_slug);
    const id = newId();
    await tx.run(
      "INSERT INTO comments (id, room_id, author_id, body, anchor, pose, revision_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, comment.roomId, comment.authorId, comment.body, JSON.stringify(comment.anchor), JSON.stringify(comment.pose), head.id, comment.createdAt],
    );
    const stored = commentFromRow(await tx.one<CommentSql>(`${COMMENTS} WHERE c.id = $1`, [id]));
    await emit(tx, room.part_slug, "comment", comment.roomId, { type: "comment", comment: stored });
    return stored;
  });
}

// ------------------------------------------------------------------------------------------------ approvals

export async function approve(roomId: string, reviewerId: string, revisionId: unknown, at: Date): Promise<{ room: RoomJson; created: boolean }> {
  return transaction(async (tx) => {
    const room = await tx.one<RoomSql>("SELECT * FROM rooms WHERE id = $1", [roomId]);
    const part = await requirePart(tx, room.part_slug, true);
    await assertOpen(tx, roomId);
    const named = typeof revisionId === "string" ? await loadRevision(tx, revisionId) : undefined;
    const head = await headRevision(tx, part.slug);
    if (named && named.part_slug === part.slug && named.id !== head.id) {
      throw new ApiError(409, "stale_revision", `${revisionLabel(named.n)} is no longer the head; review ${revisionLabel(head.n)} before approving.`);
    }
    if (!named || named.part_slug !== part.slug) throw invalid({ revisionId: "Choose a revision of this part." });
    if (part.ownerId === reviewerId) throw new ApiError(422, "own_revision", "Owners cannot approve their own revision.");
    const added = await tx.run(
      "INSERT INTO approvals (room_id, reviewer_id, revision_id, geometry_digest, at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [roomId, reviewerId, head.id, head.geometry_digest, at],
    );
    const stored = await roomJson(tx, roomId);
    if (added === 1) {
      const reviewer = await tx.one<{ display_name: string }>("SELECT display_name FROM users WHERE id = $1", [reviewerId]);
      await emit(tx, part.slug, "approvals", roomId, { type: "approvals", room: stored, reason: "approved", label: revisionLabel(head.n), displayName: reviewer.display_name });
    }
    return { room: stored, created: added === 1 };
  });
}

// ------------------------------------------------------------------------------------------------ rooms

interface NewRoom {
  partSlug: string;
  ownerId: string;
  title: string;
  reviewerEmails: string[];
  createdAt: Date;
  /** Whether to send each reviewer the invitation mail. */
  invite: boolean;
}

export async function insertRoom(room: NewRoom): Promise<RoomJson> {
  const id = newId();
  return transaction(async (tx) => {
    const part = await requirePart(tx, room.partSlug);
    await tx.run("INSERT INTO rooms (id, part_slug, base_revision_id, owner_id, title, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      id, room.partSlug, part.headId, room.ownerId, room.title, room.createdAt,
    ]);
    for (const email of room.reviewerEmails) {
      await tx.run("INSERT INTO room_reviewers (room_id, email, email_fold) VALUES ($1, $2, $3)", [id, email, foldEmail(email)]);
    }
    if (room.invite) {
      const volume = await tx.one<{ volume: number }>(
        "SELECT e.volume FROM revisions r JOIN evaluations e ON e.id = r.evaluation_id WHERE r.id = $1",
        [part.headId],
      );
      for (const email of room.reviewerEmails) {
        const body = [`Room: ${room.title}`, `Revision: ${revisionLabel(part.headN)}`, `Head volume: ${volumeText(volume.volume)}`, `${config.publicUrl}/rooms/${id}`].join("\n");
        await sendMail(email, `Review ${part.title} on Tinework`, `${body}\n`);
      }
    }
    return roomJson(tx, id);
  });
}

function parseReviewers(raw: Json | undefined): string[] | null {
  if (!Array.isArray(raw) || !raw.every(isEmail)) return null;
  const seen = new Map(raw.map((email) => [foldEmail(email), email]));
  return [...seen.values()];
}

async function createRoomRoute(ctx: Ctx) {
  const user = await ctx.requireUser();
  const part = await readablePart(ctx, ctx.params.slug);
  if (part.ownerId !== user.id) throw forbidden();
  return idempotent(ctx, user, async () => {
    ctx.checkNumbers();
    const { title, reviewers } = ctx.json();
    const errors: Record<string, string> = {};
    const name = boundedText(title, TITLE_MAX);
    if (name === null) errors.title = boundedMessage(TITLE_MAX);
    const emails = parseReviewers(reviewers);
    if (emails === null) errors.reviewers = "Enter valid email addresses.";
    else if (emails.length < config.requiredApprovals) errors.reviewers = `Invite at least ${config.requiredApprovals} reviewers.`;
    if (name === null || emails === null || Object.keys(errors).length > 0) throw invalid(errors);
    try {
      const room = await insertRoom({ partSlug: part.slug, ownerId: user.id, title: name, reviewerEmails: emails, createdAt: new Date(), invite: true });
      return jsonReply(201, room, { Location: `/api/rooms/${room.id}` });
    } catch (error) {
      if (error instanceof MailUnavailable) {
        throw new ApiError(503, "mail_unavailable", "We could not send the invitations right now. Try again in a minute.");
      }
      throw error;
    }
  });
}

/** A room the caller may see: only the part's owner and the room's reviewers; everyone else gets a 404. */
async function roomFor(ctx: Ctx): Promise<{ user: User; room: RoomSql; isOwner: boolean }> {
  const user = await ctx.requireUser();
  const room = await db.row<RoomSql>("SELECT * FROM rooms WHERE id = $1", [ctx.params.id]);
  const part = room && (await loadPart(db, room.part_slug));
  if (!room || !part) throw notFound();
  const isOwner = part.ownerId === user.id;
  if (!isOwner && !(await isReviewer(db, user, { roomId: room.id }))) throw notFound();
  return { user, room, isOwner };
}

async function readRoom(ctx: Ctx) {
  const { room } = await roomFor(ctx);
  const comments = await db.rows<CommentSql>(`${COMMENTS} WHERE c.room_id = $1 ORDER BY c.created_at, c.id`, [room.id]);
  return jsonReply(200, { room: await roomJson(db, room.id), comments: comments.map(commentFromRow) });
}

async function postComment(ctx: Ctx) {
  const { user, room } = await roomFor(ctx);
  return idempotent(ctx, user, async () => {
    await assertOpen(db, room.id);
    ctx.checkNumbers();
    const { body, anchor, pose } = ctx.json();
    const text = typeof body === "string" ? normalizeText(body) : "";
    const length = graphemeCount(text);
    if (length > config.commentMaxChars) {
      const message = `Comments can be at most ${config.commentMaxChars} characters.`;
      throw new ApiError(422, "comment_too_long", message, { errors: { body: message } });
    }
    const errors: Record<string, string> = {};
    if (length === 0) errors.body = "Write a comment first.";
    const parsedAnchor = parseAnchor(anchor);
    if (parsedAnchor === null) errors.anchor = "Choose a point or none.";
    const parsedPose = parsePose(pose);
    if (parsedPose === null) errors.pose = "Send the camera pose.";
    if (Object.keys(errors).length > 0 || !parsedAnchor || !parsedPose) throw invalid(errors);
    const comment = await insertComment({ roomId: room.id, authorId: user.id, body: text, anchor: parsedAnchor, pose: parsedPose, createdAt: new Date() });
    return jsonReply(201, comment);
  });
}

async function postApproval(ctx: Ctx) {
  const { user, room } = await roomFor(ctx);
  return idempotent(ctx, user, async () => {
    ctx.checkNumbers();
    const { room: stored, created } = await approve(room.id, user.id, ctx.json().revisionId, new Date());
    return jsonReply(created ? 201 : 200, stored);
  });
}

async function closeRoom(ctx: Ctx) {
  const { room, isOwner } = await roomFor(ctx);
  if (!isOwner) throw forbidden();
  const stored = await transaction(async (tx) => {
    const part = await requirePart(tx, room.part_slug, true);
    await assertOpen(tx, room.id);
    await tx.run("UPDATE rooms SET closed = true WHERE id = $1", [room.id]);
    const closed = await roomJson(tx, room.id);
    await emit(tx, part.slug, "approvals", room.id, { type: "approvals", room: closed, reason: "closed", label: revisionLabel(part.headN), displayName: null });
    return closed;
  });
  return jsonReply(200, stored);
}

export const roomRoutes: Route[] = [
  post("/api/parts/:slug/rooms", createRoomRoute),
  get("/api/rooms/:id", readRoom),
  post("/api/rooms/:id/comments", postComment),
  post("/api/rooms/:id/approvals", postApproval),
  post("/api/rooms/:id/close", closeRoom),
];
