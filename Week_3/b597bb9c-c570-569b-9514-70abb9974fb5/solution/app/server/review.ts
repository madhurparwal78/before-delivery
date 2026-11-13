import { createHash, randomBytes } from "node:crypto";
import { codePoints } from "../shared/codepoints";
import { FIELD_ERRORS } from "../shared/copy";
import { LINK_MAX_SECONDS, LINK_MIN_SECONDS, NAME_MAX } from "../shared/limits";
import type { Clip, Comment, ReviewLink } from "../shared/types";
import { config } from "./config";
import { listComments, parseNote } from "./comments";
import { cutById } from "./cuts";
import { one, pool, query, tx } from "./db";
import { AppError, invalid, notFound } from "./errors";
import { newId } from "./ids";
import { hub } from "./live";
import { linkState, type LinkRow } from "./links";
import { mediaDimsOf, markersOf } from "./projects";
import { publicCaption, publicRow } from "./records";
import type { CutSnapshot } from "./timeline/engine";
import { loadProjectRow } from "./timeline/store";
import { frameSize } from "../shared/layers";

function linkRecord(row: LinkRow): ReviewLink {
  return {
    id: row.id,
    token: row.token,
    url: `${config.publicUrl}/review/${row.token}`,
    cut_id: row.cut_id,
    expires_at: row.expires_at.toISOString(),
    state: linkState(row),
  };
}

const newToken = (): string => `rv-${randomBytes(15).toString("hex")}`;

async function markShared(cutId: string): Promise<void> {
  await query("UPDATE cuts SET shared = true WHERE id = $1", [cutId]);
}

export async function createLink(projectId: string, raw: unknown): Promise<ReviewLink> {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const seconds = input["expires_in_seconds"];
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < LINK_MIN_SECONDS || seconds > LINK_MAX_SECONDS) {
    throw invalid({ expires_in_seconds: FIELD_ERRORS.expires_in_seconds });
  }
  if (typeof input["cut_id"] !== "string") throw invalid({ cut_id: FIELD_ERRORS.other });
  await cutById(pool, projectId, input["cut_id"]);
  const row = await one<LinkRow>(
    "INSERT INTO review_links (id, project_id, cut_id, token, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5)) RETURNING *",
    [newId("l"), projectId, input["cut_id"], newToken(), seconds],
  );
  if (!row) throw notFound();
  await markShared(row.cut_id);
  return linkRecord(row);
}

export async function listLinks(projectId: string): Promise<ReviewLink[]> {
  const rows = await query<LinkRow>("SELECT * FROM review_links WHERE project_id = $1 ORDER BY seq", [projectId]);
  return rows.map(linkRecord);
}

async function linkById(id: string): Promise<LinkRow> {
  const row = await one<LinkRow>("SELECT * FROM review_links WHERE id = $1", [id]);
  if (!row) throw notFound();
  return row;
}

async function ownerName(): Promise<string> {
  const owner = await one<{ name: string }>("SELECT p.name FROM workspace w JOIN people p ON p.id = w.owner_id LIMIT 1");
  return owner?.name ?? "the owner";
}

function assertActive(link: LinkRow, owner: string): void {
  const state = linkState(link);
  if (state === "revoked") throw new AppError("link_revoked", { owner });
  if (state === "expired") throw new AppError("link_expired", { owner });
}

/** Raises the link's own refusal when a guarded update matched nothing because the link ended. */
async function endedError(linkId: string): Promise<AppError> {
  const link = await linkById(linkId);
  return new AppError(linkState(link) === "expired" ? "link_expired" : "link_revoked", { owner: await ownerName() });
}

export async function shareCut(linkId: string, raw: unknown): Promise<ReviewLink> {
  const link = await linkById(linkId);
  const cutId = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["cut_id"] : undefined;
  if (typeof cutId !== "string") throw invalid({ cut_id: FIELD_ERRORS.other });
  const cut = await cutById(pool, link.project_id, cutId);
  const row = await one<LinkRow>("UPDATE review_links SET cut_id = $2 WHERE id = $1 AND NOT revoked AND expires_at > now() RETURNING *", [linkId, cutId]);
  if (!row) throw await endedError(linkId);
  await markShared(cutId);
  const shared = { ...cut, shared: true };
  hub.toProject(link.project_id, { type: "cut_shared", cut: shared });
  hub.toReview(link.id, { type: "cut_shared", cut: shared });
  return linkRecord(row);
}

export async function regenerateLink(linkId: string): Promise<ReviewLink> {
  const fresh = await tx(async (db) => {
    const old = await one<LinkRow>("UPDATE review_links SET revoked = true WHERE id = $1 AND NOT revoked RETURNING *", [linkId], db);
    if (!old) return undefined;
    return one<LinkRow>(
      "INSERT INTO review_links (id, project_id, cut_id, token, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [newId("l"), old.project_id, old.cut_id, newToken(), old.expires_at],
      db,
    );
  });
  if (!fresh) throw await endedError(linkId);
  hub.closeLink(linkId);
  return linkRecord(fresh);
}

export async function revokeLink(linkId: string): Promise<void> {
  await linkById(linkId);
  await query("UPDATE review_links SET revoked = true WHERE id = $1", [linkId]);
  hub.closeLink(linkId);
}

/** The link behind a review token, refused with the published copy when it ended. */
async function activeLink(token: string): Promise<LinkRow> {
  const link = await one<LinkRow>("SELECT * FROM review_links WHERE token = $1", [token]);
  if (!link) throw notFound();
  assertActive(link, await ownerName());
  return link;
}

export async function reviewBody(token: string): Promise<{ body: string; etag: string }> {
  const link = await activeLink(token);
  const project = await loadProjectRow(pool, link.project_id);
  const cut = await one<{ id: string; name: string; total_frames: number; snapshot: CutSnapshot }>(
    "SELECT id, name, total_frames, snapshot FROM cuts WHERE id = $1",
    [link.cut_id],
  );
  if (!project || !cut) throw notFound();
  const comments = await listComments(pool, project.id, "AND visibility = 'review' AND cut_id = $2", [cut.id]);
  const approvals = (await cutById(pool, project.id, cut.id)).approvals;
  const size = frameSize(project.aspect_ratio);
  const payload = {
    project: { title: project.title, frame_rate: project.frame_rate, aspect_ratio: project.aspect_ratio, width: size.width, height: size.height },
    owner_name: await ownerName(),
    cut: {
      id: cut.id,
      name: cut.name,
      total_frames: cut.total_frames,
      rows: cut.snapshot.rows.map(publicRow),
      clips: cut.snapshot.clips,
      captions: cut.snapshot.captions.map(publicCaption),
      media: await mediaDimsOf(pool, cut.snapshot.clips),
      markers: await markersOf(pool, project),
    },
    comments,
    approvals,
  };
  const body = JSON.stringify(payload);
  return { body, etag: `"${createHash("sha256").update(body).digest("hex")}"` };
}

function clientName(raw: unknown, field: string): string {
  const name = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)[field] : undefined;
  if (typeof name !== "string" || name.trim().length === 0 || codePoints(name) > NAME_MAX) throw invalid({ name: FIELD_ERRORS.reviewerName });
  return name.trim();
}

/** The clip on the frontmost video row at a cut frame, for pinning a client note to it. */
function clipAt(snapshot: CutSnapshot, frame: number): Clip | undefined {
  const position = new Map(snapshot.rows.map((row) => [row.id, row.position]));
  return snapshot.clips
    .filter((clip) => clip.kind !== "wav" && clip.start_frame <= frame && frame < clip.end_frame)
    .sort((a, b) => (position.get(a.row_id) ?? 0) - (position.get(b.row_id) ?? 0))[0];
}

export async function clientComment(token: string, raw: unknown): Promise<Comment> {
  const link = await activeLink(token);
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  let name = "";
  try {
    name = clientName(raw, "name");
  } catch (error) {
    if (error instanceof AppError) Object.assign(errors, (error.extra["errors"] as Record<string, string>) ?? {});
  }
  const note = (() => {
    try {
      return parseNote({ body: input["body"], frame: input["frame"], visibility: "review" });
    } catch (error) {
      if (error instanceof AppError) Object.assign(errors, (error.extra["errors"] as Record<string, string>) ?? {});
      return null;
    }
  })();
  if (Object.keys(errors).length || !note) throw invalid(errors);
  const cut = await one<{ snapshot: CutSnapshot }>("SELECT snapshot FROM cuts WHERE id = $1", [link.cut_id]);
  const clip = cut ? clipAt(cut.snapshot, note.frame) : undefined;
  const id = newId("n");
  await query(
    `INSERT INTO comments (id, project_id, author_name, body, visibility, cut_id, pin_frame, pin_row_id, pin_clip_id, pin_offset, mentions)
     VALUES ($1,$2,$3,$4,'review',$5,$6,$7,$8,$9,'[]')`,
    [id, link.project_id, name, note.body, link.cut_id, note.frame, clip?.row_id ?? null, clip?.id ?? null, clip ? note.frame - clip.start_frame : null],
  );
  const comment = (await listComments(pool, link.project_id, "AND id = $2", [id]))[0];
  if (!comment) throw notFound();
  hub.toProject(link.project_id, { type: "comment", comment });
  hub.toReview(link.id, { type: "comment", comment });
  return comment;
}

export async function clientApproval(token: string, raw: unknown): Promise<{ cut_id: string; approvals: { name: string; at: string }[] }> {
  const link = await activeLink(token);
  const name = clientName(raw, "name");
  await query("INSERT INTO approvals (cut_id, name) VALUES ($1,$2) ON CONFLICT (cut_id, name) DO NOTHING", [link.cut_id, name]);
  return { cut_id: link.cut_id, approvals: (await cutById(pool, link.project_id, link.cut_id)).approvals };
}
