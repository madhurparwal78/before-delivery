// Comments, replies, resolve and mention email (brief: Comments, Services Mailpit).
import { copy, shapeLabel } from "../shared/copy";
import { ApiError, requireFields } from "../shared/errors";
import { mentionedEmails } from "../shared/mentions";
import { canResolve } from "../shared/rules";
import { LIMITS } from "../shared/text";
import type { CommentView } from "../shared/types";
import { diagramAccess } from "./access";
import { requireUser } from "./auth";
import { one, pool } from "./db";
import { loadDocument } from "./diagrams";
import { json, objectBody, route } from "./http";
import { newId } from "./ids";
import { broadcast } from "./live";
import { diagramLink, sendMail } from "./mail";

interface CommentRow {
  id: string;
  shape_id: string;
  page_id: string;
  author_id: string;
  author_name: string;
  text: string;
  resolved: boolean;
  anchored: boolean;
  parent_id: string | null;
  created_at: Date;
}

const SELECT = `SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.author_id`;

function view(row: CommentRow): CommentView {
  return {
    id: row.id, shape: row.shape_id, page: row.page_id, author: { id: row.author_id, name: row.author_name }, text: row.text,
    resolved: row.resolved, anchored: row.anchored, parent: row.parent_id, createdAt: row.created_at.toISOString(),
  };
}

/** Where a shape id stands in this diagram: present (with page and label), deleted, or never part of it. */
type ShapeStatus = { kind: "present"; page: string; label: string } | { kind: "deleted" } | { kind: "missing" };

async function shapeStatus(diagramId: string, shapeId: unknown): Promise<ShapeStatus> {
  if (typeof shapeId !== "string") return { kind: "missing" };
  const doc = await loadDocument(pool, diagramId);
  for (const page of doc.pages) {
    const shape = page.shapes.find((s) => s.id === shapeId);
    if (shape) return { kind: "present", page: page.id, label: shapeLabel(shape) };
  }
  const { rowCount } = await pool.query("SELECT 1 FROM operations WHERE diagram_id = $1 AND touched ? $2", [diagramId, `shape:${shapeId}:deleted`]);
  return rowCount ? { kind: "deleted" } : { kind: "missing" };
}

route("GET", "/api/diagrams/:id/comments", async (req) => {
  const access = await diagramAccess(await requireUser(req), req.params[0] as string);
  const { rows } = await pool.query<CommentRow>(`${SELECT} WHERE c.diagram_id = $1 ORDER BY c.created_at, c.id`, [access.diagramId]);
  return json(200, { comments: rows.map(view) });
});

route("POST", "/api/diagrams/:id/comments", async (req) => {
  const access = await diagramAccess(await requireUser(req), req.params[0] as string);
  const { shape, text, parent } = objectBody(req.body);
  const status = await shapeStatus(access.diagramId, shape);
  if (typeof shape === "string" && status.kind === "missing") throw new ApiError("not_found");
  if (parent !== undefined && parent !== null) {
    const found = typeof parent === "string" ? await pool.query("SELECT 1 FROM comments WHERE id = $1 AND diagram_id = $2", [parent, access.diagramId]) : null;
    if (!found?.rowCount) throw new ApiError("not_found");
  }
  if (status.kind === "deleted") throw new ApiError("shape_deleted");
  requireFields({
    shape: status.kind === "present" ? null : "Choose a shape.",
    text: typeof text === "string" && text.trim().length >= 1 && text.length <= LIMITS.comment ? null : "Write a comment of 1 to 2,000 characters.",
  });
  if (status.kind !== "present" || typeof text !== "string") throw new ApiError("invalid");
  const where = status;
  const id = newId("m_");
  await pool.query("INSERT INTO comments (id, diagram_id, shape_id, page_id, author_id, text, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, access.diagramId, shape, where.page, access.user.id, text, parent ?? null]);
  const { rows } = await pool.query<CommentRow>(`${SELECT} WHERE c.id = $1`, [id]);
  broadcast(access.diagramId, { type: "comments" });
  const mentioned = mentionedEmails(text).filter((email) => email !== access.user.email);
  if (mentioned.length) {
    const members = await pool.query<{ email: string }>(
      "SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.diagram_id = $1 AND u.email = ANY($2)", [access.diagramId, mentioned]);
    const body = [
      `${access.user.name} mentioned you in a comment on "${access.title}".`,
      "",
      `Shape: ${where.label}`,
      `Comment: ${text}`,
      "",
      `Open it here: ${diagramLink(access.diagramId)}`,
    ].join("\n");
    for (const member of members.rows) void sendMail(member.email, copy.mentionSubject(access.user.name, access.title), body);
  }
  return json(201, { comment: view(one(rows)) });
});

route("POST", "/api/diagrams/:id/comments/:comment/resolve", async (req) => {
  const access = await diagramAccess(await requireUser(req), req.params[0] as string);
  const { rows } = await pool.query<CommentRow>(`${SELECT} WHERE c.id = $1 AND c.diagram_id = $2`, [req.params[1], access.diagramId]);
  const row = rows[0];
  if (!row) throw new ApiError("not_found");
  if (!canResolve(access.role, row.author_id === access.user.id)) throw new ApiError("forbidden_role");
  const claimed = await pool.query("UPDATE comments SET resolved = true WHERE id = $1 AND NOT resolved", [row.id]);
  if (!claimed.rowCount) throw new ApiError("already_resolved");
  broadcast(access.diagramId, { type: "comments" });
  return json(200, { comment: view({ ...row, resolved: true }) });
});
