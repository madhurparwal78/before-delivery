import { layersAt, frameSize } from "../shared/layers";
import { FIELD_ERRORS } from "../shared/copy";
import { codePoints } from "../shared/codepoints";
import { AVAILABILITY_MAX } from "../shared/limits";
import { timecode } from "../shared/timecode";
import { rateOf } from "../shared/rational";
import type { Role } from "../shared/types";
import { requireRole } from "./access";
import { allowance } from "./allowance";
import { clearedCookie, sessionCookie, signIn, signOut } from "./auth";
import { exportSrt, parseSrt } from "./captions";
import { listComments, parseNote, postNote } from "./comments";
import { approve, compareCuts, cutSnapshot, listCuts, nameCut } from "./cuts";
import { one, pool, query } from "./db";
import { forbidden, invalid, notFound } from "./errors";
import { cancelExport, exportById, listExports, manifestLink, projectOfExport, startExport } from "./exports";
import { empty, json, type Ctx, type Reply, type Route, type AuthKind, type BodyKind } from "./http";
import { exportQueue } from "./queue";
import { addMember, changeRole, removeMember } from "./members";
import { listOps } from "./oplog";
import { importCaptionsOp, submitHistory, submitOp } from "./ops";
import { listMedia, deleteMedia, peaksOf } from "./media/library";
import { mediaDimsOf, createProject, listProjects, membersOf, projectDetail } from "./projects";
import { readClips, readComments, readCuts, readExports, readProject, readProjects } from "./readapi";
import { clientApproval, clientComment, createLink, listLinks, regenerateLink, revokeLink, reviewBody, shareCut } from "./review";
import { reachable } from "./s3";
import { smtpReachable } from "./smtp";
import { issueToken, listTokens, revokeToken } from "./tokens";
import { completeUpload, createUpload, listUploads, putChunk, uploadState } from "./uploads";
import { outboxItems } from "./mail";
import { loadProjectRow, loadTimeline } from "./timeline/store";
import { newId } from "./ids";
import type { Kit } from "../shared/types";

const routes: Route[] = [];

function route(method: string, path: string, auth: AuthKind, body: BodyKind, handler: (ctx: Ctx) => Promise<Reply>): void {
  routes.push({ method, segments: path.split("/").filter(Boolean), auth, body, handler });
}

const MEMBER: readonly Role[] = ["owner", "editor", "commenter"];
const CUTTERS: readonly Role[] = ["owner", "editor"];
const OWNER: readonly Role[] = ["owner"];

const bodyOf = (ctx: Ctx): Record<string, unknown> => (typeof ctx.json === "object" && ctx.json !== null ? (ctx.json as Record<string, unknown>) : {});

async function projectRow(id: string) {
  const row = await loadProjectRow(pool, id);
  if (!row) throw notFound();
  return row;
}

/** Library routes need an owner or an editor on at least one project. */
async function requireLibrary(ctx: Ctx): Promise<void> {
  if (ctx.actor.is_owner) return;
  const editor = await one("SELECT 1 FROM members WHERE person_id = $1 AND role = 'editor' LIMIT 1", [ctx.actor.id]);
  if (!editor) throw forbidden();
}

// Session, people and workspace
route("GET", "/api/health", "public", "none", async () => json({ status: "ok" }));
route("POST", "/api/session", "public", "json", async (ctx) => {
  const { email, password } = bodyOf(ctx);
  const session = await signIn(email, password);
  const { is_owner: _owner, ...person } = session.actor;
  return json({ person }, 200, { "set-cookie": sessionCookie(session.sessionId) });
});
route("GET", "/api/session", "session", "none", async (ctx) => {
  const { is_owner, ...person } = ctx.actor;
  return json({ person, is_owner });
});
route("DELETE", "/api/session", "session", "none", async (ctx) => {
  await signOut(ctx.session?.sessionId ?? "");
  return empty(204, { "set-cookie": clearedCookie });
});
route("GET", "/api/status", "owner", "none", async () => {
  const [storage, queue, mail] = await Promise.all([reachable(), exportQueue.ensure(), smtpReachable()]);
  const word = (up: boolean): "up" | "down" => (up ? "up" : "down");
  return json({ storage: word(storage), queue: word(queue), mail: word(mail) });
});
route("GET", "/api/allowance", "session", "none", async () => json(await allowance()));
route("GET", "/api/profile", "session", "none", async () => {
  const row = await one<{ name: string; availability: string }>("SELECT p.name, w.availability FROM workspace w JOIN people p ON p.id = w.owner_id LIMIT 1");
  return json({ name: row?.name ?? "", availability: row?.availability ?? "" });
});
route("PUT", "/api/profile", "owner", "json", async (ctx) => {
  const availability = bodyOf(ctx)["availability"];
  if (typeof availability !== "string" || codePoints(availability) > AVAILABILITY_MAX) throw invalid({ availability: FIELD_ERRORS.other });
  await query("UPDATE workspace SET availability = $1", [availability]);
  return json({ name: ctx.actor.name, availability });
});
route("GET", "/api/outbox", "owner", "none", async () => json({ items: await outboxItems() }));

// Projects, members and the timeline
route("GET", "/api/projects", "session", "none", async (ctx) => json({ items: await listProjects(ctx.actor) }));
route("POST", "/api/projects", "owner", "json", async (ctx) => json(await createProject(ctx.actor, ctx.json), 201));
route("GET", "/api/projects/:id", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  const role = await requireRole(id, ctx.actor, MEMBER);
  return json(await projectDetail(await projectRow(id), role));
});
route("PUT", "/api/projects/:id", "session", "json", async (ctx) => json(await submitOp(ctx.params["id"] ?? "", ctx.actor, ctx.json, "aspect")));
route("GET", "/api/projects/:id/ops", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const after = Number(ctx.query.get("after") ?? 0);
  if (!Number.isInteger(after) || after < 0) throw invalid({ after: FIELD_ERRORS.other });
  return json({ ops: await listOps(id, after) });
});
route("POST", "/api/projects/:id/ops", "session", "json", async (ctx) => json(await submitOp(ctx.params["id"] ?? "", ctx.actor, ctx.json, "ops")));
route("POST", "/api/projects/:id/undo", "session", "json", async (ctx) => json(await submitHistory(ctx.params["id"] ?? "", ctx.actor, ctx.json, "undo")));
route("POST", "/api/projects/:id/redo", "session", "json", async (ctx) => json(await submitHistory(ctx.params["id"] ?? "", ctx.actor, ctx.json, "redo")));
route("GET", "/api/projects/:id/frames/:frame", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const frame = Number(ctx.params["frame"]);
  if (!Number.isInteger(frame) || frame < 0) throw invalid({ frame: FIELD_ERRORS.other });
  const project = await projectRow(id);
  const timeline = await loadTimeline(pool, project);
  const media = await mediaDimsOf(pool, timeline.clips);
  const layers = layersAt(frame, timeline.clips, timeline.rows, media, frameSize(project.aspect_ratio));
  return json({ frame, timecode: timecode(rateOf(project.frame_rate), frame), layers });
});
route("GET", "/api/projects/:id/members", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json({ items: await membersOf(pool, id) });
});
route("POST", "/api/projects/:id/members", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json(await addMember(id, ctx.json), 201);
});
route("PUT", "/api/projects/:id/members/:person", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json(await changeRole(id, ctx.params["person"] ?? "", ctx.json));
});
route("DELETE", "/api/projects/:id/members/:person", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  await removeMember(id, ctx.params["person"] ?? "");
  return empty();
});

// Captions
route("POST", "/api/projects/:id/rows/:row/captions/import", "session", "srt", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, CUTTERS);
  const project = await projectRow(id);
  const rowId = ctx.params["row"] ?? "";
  const row = await one<{ kind: string }>("SELECT kind FROM rows WHERE id = $1 AND project_id = $2", [rowId, id]);
  if (!row) throw notFound();
  const parsed = parseSrt(ctx.raw, rateOf(project.frame_rate));
  const result = await importCaptionsOp(id, ctx.actor, { type: "import_captions", row_id: rowId, cues: parsed.cues, eol: parsed.eol, bom: parsed.bom });
  return json({ cues: parsed.cues.length, version: result.version });
});
route("GET", "/api/projects/:id/rows/:row/captions/export", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, CUTTERS);
  const project = await projectRow(id);
  const row = await one<{ kind: string; srt_eol: string; srt_bom: boolean }>("SELECT kind, srt_eol, srt_bom FROM rows WHERE id = $1 AND project_id = $2", [ctx.params["row"] ?? "", id]);
  if (!row) throw notFound();
  if (row.kind !== "caption") throw invalid({ row_id: FIELD_ERRORS.other });
  const raw = await exportSrt(id, ctx.params["row"] ?? "", rateOf(project.frame_rate), row.srt_eol, row.srt_bom);
  return { status: 200, raw, type: "application/x-subrip; charset=utf-8", headers: { "content-disposition": `attachment; filename="${id}-${ctx.params["row"]}.srt"` } };
});

// Cuts and review links
route("GET", "/api/projects/:id/cuts", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json({ items: await listCuts(id) });
});
route("POST", "/api/projects/:id/cuts", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json(await nameCut(id, ctx.json), 201);
});
route("GET", "/api/projects/:id/cuts/:cut", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json(await cutSnapshot(id, ctx.params["cut"] ?? ""));
});
route("GET", "/api/projects/:id/cuts/:a/compare/:b", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json(await compareCuts(id, ctx.params["a"] ?? "", ctx.params["b"] ?? ""));
});
route("POST", "/api/projects/:id/cuts/:cut/approval", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, ["owner", "commenter"]);
  return json(await approve(id, ctx.params["cut"] ?? "", ctx.actor));
});
route("POST", "/api/projects/:id/cuts/:cut/restore", "session", "json", async (ctx) =>
  json(await submitOp(ctx.params["id"] ?? "", ctx.actor, ctx.json, "restore", ctx.params["cut"] ?? "")),
);
route("POST", "/api/projects/:id/review-links", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json(await createLink(id, ctx.json), 201);
});
route("GET", "/api/projects/:id/review-links", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json({ items: await listLinks(id) });
});
route("PUT", "/api/review-links/:id", "owner", "json", async (ctx) => json(await shareCut(ctx.params["id"] ?? "", ctx.json)));
route("POST", "/api/review-links/:id/regenerate", "owner", "none", async (ctx) => json(await regenerateLink(ctx.params["id"] ?? ""), 201));
route("DELETE", "/api/review-links/:id", "owner", "none", async (ctx) => {
  await revokeLink(ctx.params["id"] ?? "");
  return empty();
});

// Review (client, no session)
route("GET", "/api/review/:token", "public", "none", async (ctx) => {
  const { body, etag } = await reviewBody(ctx.params["token"] ?? "");
  const headers = { etag, "cache-control": "private, no-cache" };
  if (ctx.request.headers["if-none-match"] === etag) return { status: 304, headers };
  return json(body, 200, headers);
});
route("POST", "/api/review/:token/comments", "public", "json", async (ctx) => json(await clientComment(ctx.params["token"] ?? "", ctx.json), 201));
route("POST", "/api/review/:token/approve", "public", "json", async (ctx) => json(await clientApproval(ctx.params["token"] ?? "", ctx.json)));

// Comments and drafts
route("GET", "/api/projects/:id/comments", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const cut = ctx.query.get("cut_id");
  return json({ items: cut ? await listComments(pool, id, "AND cut_id = $2", [cut]) : await listComments(pool, id) });
});
route("POST", "/api/projects/:id/comments", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json(await postNote(id, ctx.actor, ctx.json), 201);
});
route("GET", "/api/projects/:id/comment-draft", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const draft = await one(
    "SELECT body, frame, row_id, clip_id, cut_id, visibility, parent_id, updated_at FROM comment_drafts WHERE project_id = $1 AND person_id = $2",
    [id, ctx.actor.id],
  );
  return json({ draft: draft ?? null });
});
route("PUT", "/api/projects/:id/comment-draft", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const note = parseNote(ctx.json, true);
  const draft = await one(
    `INSERT INTO comment_drafts (project_id, person_id, body, frame, row_id, clip_id, cut_id, visibility, parent_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (project_id, person_id) DO UPDATE SET body=$3, frame=$4, row_id=$5, clip_id=$6, cut_id=$7, visibility=$8, parent_id=$9, updated_at=now()
     RETURNING body, frame, row_id, clip_id, cut_id, visibility, parent_id, updated_at`,
    [id, ctx.actor.id, note.body, note.frame, note.row_id, note.clip_id, note.cut_id, note.visibility, note.parent_id],
  );
  return json({ draft });
});

// Exports
route("POST", "/api/projects/:id/exports", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  const started = await startExport(id, ctx.actor, ctx.json);
  return json(started.body, started.status);
});
route("GET", "/api/projects/:id/exports", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json({ items: await listExports(id) });
});
route("GET", "/api/exports/:id", "session", "none", async (ctx) => {
  await requireRole(await projectOfExport(ctx.params["id"] ?? ""), ctx.actor, MEMBER);
  return json(await exportById(ctx.params["id"] ?? ""));
});
route("POST", "/api/exports/:id/cancel", "session", "none", async (ctx) => {
  await requireRole(await projectOfExport(ctx.params["id"] ?? ""), ctx.actor, OWNER);
  return json(await cancelExport(ctx.params["id"] ?? ""));
});
route("GET", "/api/exports/:id/manifest", "session", "none", async (ctx) => {
  await requireRole(await projectOfExport(ctx.params["id"] ?? ""), ctx.actor, MEMBER);
  return { status: 302, headers: { location: await manifestLink(ctx.params["id"] ?? "") } };
});

// Brand kits
const kitFields = (ctx: Ctx): { name: string; text_colour: string; box_colour: string; font_weight: number } => {
  const input = bodyOf(ctx);
  const errors: Record<string, string> = {};
  const colour = (field: string): string => {
    const value = input[field];
    if (typeof value !== "string" || !/^[0-9a-fA-F]{6}$/.test(value)) errors[field] = FIELD_ERRORS.other;
    return typeof value === "string" ? value.toLowerCase() : "";
  };
  const name = typeof input["name"] === "string" ? input["name"].trim() : "";
  if (!name || codePoints(name) > 60) errors["name"] = FIELD_ERRORS.other;
  const weight = input["font_weight"];
  if (weight !== 400 && weight !== 600) errors["font_weight"] = FIELD_ERRORS.other;
  const fields = { name, text_colour: colour("text_colour"), box_colour: colour("box_colour"), font_weight: weight as number };
  if (Object.keys(errors).length) throw invalid(errors);
  return fields;
};
route("GET", "/api/kits", "session", "none", async (ctx) => {
  await requireLibrary(ctx);
  return json({ items: await query<Kit>("SELECT id, name, text_colour, box_colour, font_weight FROM kits ORDER BY seq") });
});
route("POST", "/api/kits", "owner", "json", async (ctx) => {
  const kit = kitFields(ctx);
  const row = await one<Kit>("INSERT INTO kits (id, name, text_colour, box_colour, font_weight) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, text_colour, box_colour, font_weight", [newId("kit"), kit.name, kit.text_colour, kit.box_colour, kit.font_weight]);
  return json(row, 201);
});
route("PUT", "/api/kits/:id", "owner", "json", async (ctx) => {
  const kit = kitFields(ctx);
  const row = await one<Kit>("UPDATE kits SET name=$2, text_colour=$3, box_colour=$4, font_weight=$5 WHERE id=$1 RETURNING id, name, text_colour, box_colour, font_weight", [ctx.params["id"], kit.name, kit.text_colour, kit.box_colour, kit.font_weight]);
  if (!row) throw notFound();
  return json(row);
});

// Read tokens
route("POST", "/api/tokens", "owner", "json", async (ctx) => json(await issueToken(ctx.json), 201));
route("GET", "/api/tokens", "owner", "none", async () => json({ items: await listTokens() }));
route("DELETE", "/api/tokens/:id", "owner", "none", async (ctx) => {
  if (!(await revokeToken(ctx.params["id"] ?? ""))) throw notFound();
  return empty();
});

// Uploads and media
route("POST", "/api/uploads", "owner", "json", async (ctx) => {
  const made = await createUpload(ctx.actor.id, ctx.json);
  return json(made.body, made.status);
});
route("GET", "/api/uploads", "owner", "none", async (ctx) => json({ items: await listUploads(ctx.actor.id) }));
route("PUT", "/api/uploads/:id/chunks/:n", "owner", "octet", async (ctx) => {
  await putChunk(ctx.actor.id, ctx.params["id"] ?? "", Number(ctx.params["n"]), ctx.raw);
  return empty();
});
route("GET", "/api/uploads/:id", "owner", "none", async (ctx) => json(await uploadState(ctx.actor.id, ctx.params["id"] ?? "")));
route("POST", "/api/uploads/:id/complete", "owner", "none", async (ctx) => {
  const done = await completeUpload(ctx.actor.id, ctx.params["id"] ?? "");
  return json(done.body, done.status);
});
route("GET", "/api/media", "session", "none", async (ctx) => {
  await requireLibrary(ctx);
  return json(await listMedia(ctx.query));
});
route("GET", "/api/media/:id/peaks", "session", "none", async (ctx) => {
  await requireLibrary(ctx);
  return json({ peaks: await peaksOf(ctx.params["id"] ?? "") });
});
route("DELETE", "/api/media/:id", "owner", "none", async (ctx) => {
  await deleteMedia(ctx.params["id"] ?? "");
  return empty();
});

// The agency read API
route("GET", "/api/v1/projects", "token", "none", async (ctx) => json(await readProjects(ctx.query)));
route("GET", "/api/v1/projects/:id", "token", "none", async (ctx) => json(await readProject(ctx.params["id"] ?? "")));
route("GET", "/api/v1/projects/:id/clips", "token", "none", async (ctx) => json(await readClips(ctx.params["id"] ?? "", ctx.query)));
route("GET", "/api/v1/projects/:id/cuts", "token", "none", async (ctx) => json(await readCuts(ctx.params["id"] ?? "", ctx.query)));
route("GET", "/api/v1/projects/:id/exports", "token", "none", async (ctx) => json(await readExports(ctx.params["id"] ?? "", ctx.query)));
route("GET", "/api/v1/projects/:id/comments", "token", "none", async (ctx) => json(await readComments(ctx.params["id"] ?? "", ctx.query)));

export const apiRoutes: readonly Route[] = routes;
