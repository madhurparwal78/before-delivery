import { randomUUID } from "node:crypto";
import { isStudio, requireRole, type Member } from "../auth.js";
import { one, pool, rows, tx, type Db } from "../db.js";
import { awaitingReview, canResubmit, mayReview, REVIEW_CODES, REVIEWERS, reviewCodeLabel } from "../domain/review.js";
import { isOverdue, reviewDueOn } from "../domain/reviewclock.js";
import { conflict, forbidden, illegalTransition, notFound } from "../http/errors.js";
import type { Multipart } from "../http/multipart.js";
import { ok, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { holdsContract, knownId, visibleProject, type Project } from "../scope.js";
import { acceptFile, fileHeaders, type AcceptedFile } from "../services/files.js";
import { deleteObject, getObject, putObject } from "../services/storage.js";

// Shop drawings: submissions, the five-working-day review clock and review codes (brief: Shop-drawing review clock).

const CLOCK_START = Date.parse("2025-12-31T16:00:00.000Z"); // 1 Jan 2026 00:00 HKT
const RECEIVED_RANGE_COPY = "Received at must be between 1 Jan 2026 and now.";

interface DrawingRow {
  id: string;
  project_id: string;
  reference: string;
  title: string;
}

interface SubmissionRow {
  shop_drawing_id: string;
  submission: number;
  received_at: Date;
  review_due_on: string;
  extension: string;
  content_type: string;
  review_code: number | null;
  review_comments: string | null;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reviewed_at: Date | null;
}

const SUBMISSION_SELECT = `SELECT s.*, m.name AS reviewer_name FROM shop_drawing_submissions s LEFT JOIN members m ON m.id = s.reviewed_by`;

const fileKey = (projectId: string, drawingId: string, submission: number, extension: string): string =>
  `projects/${projectId}/shop-drawings/${drawingId}/${submission}.${extension}`;

function drawingJson(drawing: DrawingRow, latest: SubmissionRow, viewer: Member) {
  const reviewed = !awaitingReview(latest.review_code);
  return {
    id: drawing.id, reference: drawing.reference, title: drawing.title, submission: latest.submission,
    status: reviewed ? "returned" : "received",
    receivedAt: new Date(latest.received_at).toISOString(), reviewDueOn: latest.review_due_on,
    overdue: isOverdue(latest.review_due_on, !reviewed),
    canReview: mayReview(viewer.role, latest.review_code),
    canResubmit: reviewed && canResubmit(latest.review_code ?? 0),
    review: reviewed ? {
      code: latest.review_code, label: reviewCodeLabel(latest.review_code ?? 0), comments: latest.review_comments ?? "",
      by: latest.reviewer_name, at: new Date(latest.reviewed_at ?? 0).toISOString(),
    } : null,
  };
}

/** The latest submission; `lock` first takes the drawing row, so simultaneous returns queue and the later one sees the winner. */
async function latestSubmission(db: Db, drawingId: string, lock = false): Promise<SubmissionRow> {
  if (lock) await db.query("SELECT id FROM shop_drawings WHERE id = $1 FOR UPDATE", [drawingId]);
  const row = await one<SubmissionRow>(db, `${SUBMISSION_SELECT} WHERE s.shop_drawing_id = $1 ORDER BY s.submission DESC LIMIT 1`, [drawingId]);
  return row!;
}

/** Studio roles and the contractor holding the contract see shop drawings; anyone else in scope is forbidden. */
function requireViewer(member: Member, project: Project): void {
  if (!isStudio(member) && !holdsContract(member, project)) throw forbidden();
}

function requireSubmitter(member: Member, project: Project): void {
  if (!holdsContract(member, project)) requireRole(member, "director", "project_lead", "designer");
}

async function visibleDrawing(db: Db, member: Member, id: string): Promise<{ drawing: DrawingRow; project: Project }> {
  const drawing = await one<DrawingRow>(db, "SELECT id, project_id, reference, title FROM shop_drawings WHERE id = $1", [knownId(id)]);
  if (!drawing) throw notFound();
  return { drawing, project: await visibleProject(db, member, drawing.project_id) };
}

/** The received instant: the server's now for a contractor, or a studio-logged instant within the clock's range. */
function receivedAt(fields: Fields, member: Member, form: Multipart): Date {
  const given = form.fields.receivedAt;
  const now = new Date();
  if (given === undefined || given === "") return now;
  if (member.role === "contractor") {
    fields.fail("receivedAt", "Only the studio can log a received time.");
    return now;
  }
  const instant = Date.parse(given);
  if (Number.isNaN(instant) || instant < CLOCK_START || instant > now.getTime()) {
    fields.fail("receivedAt", RECEIVED_RANGE_COPY);
    return now;
  }
  return new Date(instant);
}

/** Stores a submission file, then its record; a failed record write removes the file again. */
async function storeSubmission(project: Project, drawingId: string, submission: number, file: AcceptedFile,
  write: () => Promise<void>): Promise<void> {
  const key = fileKey(project.id, drawingId, submission, file.kind);
  await putObject(key, file.data, file.contentType);
  try {
    await write();
  } catch (error) {
    await deleteObject(key);
    throw error;
  }
}

const insertSubmission = `INSERT INTO shop_drawing_submissions
  (shop_drawing_id, submission, received_at, review_due_on, extension, content_type, bytes, original_name, submitted_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

export const routes: Route[] = [
  {
    method: "GET", path: "/api/projects/:id/shop-drawings", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      requireViewer(ctx.me, project);
      const drawings = await rows<DrawingRow>(pool,
        "SELECT id, project_id, reference, title FROM shop_drawings WHERE project_id = $1 ORDER BY created_at, reference", [project.id]);
      const list = [];
      for (const drawing of drawings) list.push(drawingJson(drawing, await latestSubmission(pool, drawing.id), ctx.me));
      return ok({ shopDrawings: list });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/shop-drawings", auth: "member", body: "multipart",
    handler: async (ctx) => {
      const member = ctx.me;
      const project = await visibleProject(pool, member, ctx.params.id);
      requireSubmitter(member, project);
      const form = ctx.multipart();
      const fields = new Fields(form.fields);
      const reference = fields.text("reference", "Reference", { max: 20, oneLine: true });
      const title = fields.text("title", "Title", { max: 120, oneLine: true });
      const file = acceptFile(fields, form.files.file?.[0], "Drawing file");
      const received = receivedAt(fields, member, form);
      fields.done();
      const accepted = file!;
      const id = randomUUID();
      await storeSubmission(project, id, 1, accepted, () => tx(async (client) => {
        await client.query("INSERT INTO shop_drawings (id, project_id, reference, title) VALUES ($1, $2, $3, $4)", [id, project.id, reference, title]);
        await client.query(insertSubmission, [id, 1, received.toISOString(), reviewDueOn(received), accepted.kind, accepted.contentType,
          accepted.bytes, accepted.name, member.id]);
      }));
      const drawing: DrawingRow = { id, project_id: project.id, reference, title };
      return ok({ shopDrawing: drawingJson(drawing, await latestSubmission(pool, id), ctx.me) }, 201);
    },
  },
  {
    method: "POST", path: "/api/shop-drawings/:id/review", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      const { drawing } = await visibleDrawing(pool, member, ctx.params.id);
      requireRole(member, ...REVIEWERS);
      return tx(async (client) => {
        const latest = await latestSubmission(client, drawing.id, true);
        if (!awaitingReview(latest.review_code)) {
          throw conflict("already_reviewed", { by: latest.reviewer_name, at: new Date(latest.reviewed_at ?? 0).toISOString() });
        }
        const body = record(ctx.json());
        const fields = new Fields(body);
        const code = fields.integer("code", "Review code", 1, REVIEW_CODES.length);
        const comments = fields.text("comments", "Comments", { min: 0, max: 2000 });
        if (!fields.has("code") && !fields.has("comments") && code !== 1 && !comments.trim()) {
          fields.fail("comments", `Comments are needed for ${reviewCodeLabel(code)}.`);
        }
        fields.done();
        await client.query(
          `UPDATE shop_drawing_submissions SET review_code = $3, review_comments = $4, reviewed_by = $5, reviewed_at = now()
           WHERE shop_drawing_id = $1 AND submission = $2`, [drawing.id, latest.submission, code, comments, member.id]);
        return ok({ shopDrawing: drawingJson(drawing, await latestSubmission(client, drawing.id), member) });
      });
    },
  },
  {
    method: "POST", path: "/api/shop-drawings/:id/resubmissions", auth: "member", body: "multipart",
    handler: async (ctx) => {
      const member = ctx.me;
      const { drawing, project } = await visibleDrawing(pool, member, ctx.params.id);
      requireSubmitter(member, project);
      const latest = await latestSubmission(pool, drawing.id);
      if (latest.review_code === null || !canResubmit(latest.review_code)) {
        throw illegalTransition(latest.review_code === null ? "received" : "returned", "resubmit");
      }
      const form = ctx.multipart();
      const fields = new Fields(form.fields);
      const file = acceptFile(fields, form.files.file?.[0], "Drawing file");
      const received = receivedAt(fields, member, form);
      fields.done();
      const accepted = file!;
      const submission = latest.submission + 1;
      await storeSubmission(project, drawing.id, submission, accepted, async () => {
        await pool.query(insertSubmission, [drawing.id, submission, received.toISOString(), reviewDueOn(received), accepted.kind,
          accepted.contentType, accepted.bytes, accepted.name, member.id]);
      });
      return ok({ shopDrawing: drawingJson(drawing, await latestSubmission(pool, drawing.id), ctx.me) }, 201);
    },
  },
  {
    method: "GET", path: "/api/shop-drawings/:id/submissions/:n/file", auth: "member",
    handler: async (ctx) => {
      const { drawing, project } = await visibleDrawing(pool, ctx.me, ctx.params.id);
      requireViewer(ctx.me, project);
      const row = await one<SubmissionRow>(pool, `${SUBMISSION_SELECT} WHERE s.shop_drawing_id = $1 AND s.submission = $2`,
        [drawing.id, Number.parseInt(ctx.params.n, 10) || 0]);
      if (!row) throw notFound();
      const data = await getObject(fileKey(project.id, drawing.id, row.submission, row.extension));
      return { status: 200, body: data, headers: fileHeaders(row.content_type) };
    },
  },
];
