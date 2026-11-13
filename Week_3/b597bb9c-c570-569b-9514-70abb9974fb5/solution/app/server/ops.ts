import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Comment, LoggedOp, OpChanges, OpResult, OpSummary } from "../shared/types";
import { frameSize } from "../shared/layers";
import { requireRole, type Actor } from "./access";
import { applyPins, commentsByIds, setPinFrames } from "./comments";
import { one, tx } from "./db";
import { replayOf, resultOf, type OpRow } from "./oplog";
import { AppError, notFound } from "./errors";
import { exportsAfterOp } from "./exports";
import { hub } from "./live";
import { publicCaption, publicRow } from "./records";
import { upgradeProject } from "./upgrade";
import { applyBody, type CutSnapshot, type EngineCtx } from "./timeline/engine";
import type { Effect, Step } from "./timeline/effects";
import { Draft, type Diff, type Timeline } from "./timeline/model";
import type { OpBody } from "../shared/ops";
import { parseEnvelope, parseOpId, type OpEnvelope } from "./timeline/parse";
import { applyStep } from "./timeline/steps";
import { restoreSteps } from "./timeline/steps";
import { loadMedia, loadProjectRow, loadTimeline, persist, type ProjectRow } from "./timeline/store";

type OpKind = "ops" | "aspect" | "restore";

function opIdOf(raw: unknown): string | null {
  const id = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["op_id"] : undefined;
  return typeof id === "string" ? id : null;
}

/** Ids the request itself names, so a stale op is judged against what others changed after its base version. */
function requestTargets(body: OpBody, timeline: Timeline): string[] {
  const ids: string[] = [];
  const clip = (id: string): void => {
    ids.push(id);
    const found = timeline.clips.find((candidate) => candidate.id === id);
    if (found?.group_id) {
      ids.push(`g:${found.group_id}`);
      for (const member of timeline.clips) if (member.group_id === found.group_id) ids.push(member.id);
    }
  };
  switch (body.type) {
    case "move":
    case "trim":
    case "split":
    case "remove":
    case "set_hidden":
    case "set_speed":
    case "set_keyframe":
    case "remove_keyframe":
    case "set_layer":
      clip(body.clip_id);
      break;
    case "group":
      body.clip_ids.forEach(clip);
      break;
    case "ungroup":
      ids.push(`g:${body.group_id}`);
      break;
    case "reorder_row":
    case "lock_row":
    case "import_captions":
      ids.push(body.row_id);
      break;
    case "caption_add":
      ids.push(body.row_id);
      break;
    case "caption_edit":
    case "caption_remove":
      ids.push(body.caption_id);
      break;
    case "set_aspect":
    case "restore_cut":
      ids.push("project");
      break;
    case "add_marker":
      ids.push("markers");
      break;
    default:
      break;
  }
  return ids;
}

async function assertNoConflict(
  db: pg.PoolClient,
  projectId: string,
  actor: Actor,
  baseVersion: number,
  ids: readonly string[],
  timeline: Timeline,
): Promise<void> {
  if (!ids.length) return;
  const hit = await one<{ winner: string; summary: OpSummary; touched: string[] }>(
    `SELECT p.name AS winner, o.summary, o.touched FROM ops o JOIN people p ON p.id = o.person_id
      WHERE o.project_id = $1 AND o.version > $2 AND o.person_id <> $3 AND o.touched && $4::text[]
      ORDER BY o.version LIMIT 1`,
    [projectId, baseVersion, actor.id, [...ids]],
    db,
  );
  if (!hit) return;
  const contested = hit.touched.filter((id) => ids.includes(id));
  const clips = timeline.clips.filter((clip) => contested.includes(clip.id));
  const rows = timeline.rows.filter((row) => contested.includes(row.id)).map(publicRow);
  const captions = timeline.captions.filter((caption) => contested.includes(caption.id)).map(publicCaption);
  throw new AppError(
    "conflict",
    { winner: hit.winner, clip: clips[0]?.name ?? hit.summary.clip_name ?? "the timeline" },
    { winner: hit.winner, items: [...clips, ...rows, ...captions] },
  );
}

async function contextFor(db: pg.PoolClient, projectId: string, body: OpBody | null, timeline: Timeline): Promise<EngineCtx> {
  const mediaIds = new Set(timeline.clips.flatMap((clip) => (clip.media_id ? [clip.media_id] : [])));
  if (body?.type === "add_clip") mediaIds.add(body.media_id);
  const media = await loadMedia(db, [...mediaIds]);
  let kit: EngineCtx["kit"] = null;
  if (body?.type === "apply_kit") {
    const row = await one<{ id: string; name: string; text_colour: string; box_colour: string; font_weight: 400 | 600 }>(
      "SELECT id, name, text_colour, box_colour, font_weight FROM kits WHERE id = $1",
      [body.kit_id],
      db,
    );
    if (!row) throw notFound();
    kit = row;
  }
  let cut: EngineCtx["cut"] = null;
  if (body?.type === "restore_cut") {
    const row = await one<{ name: string; snapshot: CutSnapshot }>("SELECT name, snapshot FROM cuts WHERE id = $1 AND project_id = $2", [body.cut_id, projectId], db);
    if (!row) throw notFound();
    cut = row;
  }
  return { media, kit, cut };
}

function publicChanges(draft: Draft, diff: Diff, comments: Comment[]): OpChanges {
  const changes: OpChanges = {
    clips: diff.clips,
    captions: diff.captions.map(publicCaption),
    comments,
    rows: diff.rows.map(publicRow),
  };
  if (diff.markersBefore) changes.markers = draft.markers;
  if (diff.aspectBefore) changes.project = { aspect_ratio: draft.aspect, ...frameSize(draft.aspect) };
  return changes;
}

interface Committed {
  result: OpResult;
  summary: OpSummary;
  authorId: string;
}

interface Outcome {
  committed: Committed;
  replayed: boolean;
}

async function record(
  db: pg.PoolClient,
  project: ProjectRow,
  actor: Actor,
  opId: string,
  type: string,
  draft: Draft,
  effect: Effect,
  steps: { forward: Step | null; inverse: Step | null },
  extraTouched: readonly string[],
  commentIds: readonly string[],
): Promise<Committed> {
  const diff = draft.diff();
  await persist(db, project.id, draft, diff);
  const comments = await commentsByIds(db, project.id, commentIds);
  const changes = publicChanges(draft, diff, comments);
  const touched = [
    ...diff.clipBefore.keys(),
    ...diff.captionBefore.keys(),
    ...diff.rowBefore.keys(),
    ...diff.clips.flatMap((clip) => (clip.group_id ? [`g:${clip.group_id}`] : [])),
    ...effect.extraTouched,
    ...extraTouched,
  ];
  if (diff.markersBefore) touched.push("markers");
  const bumped = await one<{ version: number }>("UPDATE projects SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING version", [project.id], db);
  const version = bumped?.version ?? project.version + 1;
  await db.query(
    `INSERT INTO ops (project_id, version, op_id, person_id, type, summary, changes, removed, stopped, touched, forward, inverse)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      project.id, version, opId, actor.id, type, JSON.stringify(effect.summary), JSON.stringify(changes), JSON.stringify(diff.removed),
      effect.stopped ? JSON.stringify(effect.stopped) : null, [...new Set(touched)],
      steps.forward ? JSON.stringify(steps.forward) : null, steps.inverse ? JSON.stringify(steps.inverse) : null,
    ],
  );
  return { result: { version, changes, removed: diff.removed, stopped: effect.stopped }, summary: effect.summary, authorId: actor.id };
}

function announce(projectId: string, actor: Actor, committed: Committed): void {
  const message: LoggedOp = { ...committed.result, author: { id: actor.id, name: actor.name }, op: committed.summary };
  hub.toProject(projectId, { type: "op", ...message });
  void exportsAfterOp(projectId, committed.result.version);
}

/** Validates a request for the path it arrived on, then commits it. */
export async function submitOp(projectId: string, actor: Actor, raw: unknown, kind: OpKind, cutId?: string): Promise<OpResult> {
  const opId = opIdOf(raw);
  if (opId) {
    const replay = await replayOf(projectId, actor.id, opId);
    if (replay) return replay;
  }
  await requireRole(projectId, actor, kind === "ops" ? ["owner", "editor"] : ["owner"]);
  const input = typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
  if (kind === "aspect") input["type"] = "set_aspect";
  if (kind === "restore") {
    input["type"] = "restore_cut";
    input["cut_id"] = cutId;
  }
  return commitEnvelope(projectId, actor, parseEnvelope(input, kind !== "ops"));
}

/** The one path every timeline change takes, in server order. */
async function commitEnvelope(projectId: string, actor: Actor, envelope: OpEnvelope): Promise<OpResult> {
  const outcome = await tx<Outcome>(async (db) => {
    const locked = await loadProjectRow(db, projectId, true);
    if (!locked) throw notFound();
    const first = await one<OpRow>("SELECT * FROM ops WHERE project_id = $1 AND person_id = $2 AND op_id = $3", [projectId, actor.id, envelope.op_id], db);
    if (first) return { committed: { result: resultOf(first), summary: first.summary, authorId: actor.id }, replayed: true };
    await upgradeProject(db, projectId);
    const project = (await loadProjectRow(db, projectId)) ?? locked;
    const timeline = await loadTimeline(db, project);
    const targets = requestTargets(envelope.body, timeline);
    if (envelope.base_version < project.version) await assertNoConflict(db, projectId, actor, envelope.base_version, targets, timeline);
    const draft = new Draft(timeline);
    const ctx = await contextFor(db, projectId, envelope.body, timeline);
    const effect = applyBody(draft, envelope.body, ctx);
    const diff = draft.diff();
    if (envelope.base_version < project.version) {
      const changed = [...diff.clipBefore.keys(), ...diff.captionBefore.keys(), ...diff.rowBefore.keys()];
      await assertNoConflict(db, projectId, actor, envelope.base_version, changed, timeline);
    }
    const pins = await applyPins(db, projectId, effect.pins);
    const defaults = restoreSteps(diff, draft);
    const steps = effect.steps ?? {
      forward: { ...defaults.forward, pins: pins.after },
      inverse: { ...defaults.inverse, pins: pins.before },
    };
    const committed = await record(db, project, actor, envelope.op_id, envelope.body.type, draft, effect, steps, targets, pins.ids);
    await db.query("DELETE FROM undo_entries WHERE project_id = $1 AND person_id = $2 AND stack = 'redo'", [projectId, actor.id]);
    await db.query("INSERT INTO undo_entries (project_id, person_id, op_version, stack) VALUES ($1,$2,$3,'undo')", [projectId, actor.id, committed.result.version]);
    return { committed, replayed: false };
  });
  if (!outcome.replayed) announce(projectId, actor, outcome.committed);
  return outcome.committed.result;
}

/** A caption import is one op that always applies to the current timeline. */
export async function importCaptionsOp(projectId: string, actor: Actor, body: Extract<OpBody, { type: "import_captions" }>): Promise<OpResult> {
  return commitEnvelope(projectId, actor, { op_id: randomUUID(), base_version: Number.MAX_SAFE_INTEGER, body });
}

/** Undo or redo the caller's latest own change, recomputed against the timeline as it is now. */
export async function submitHistory(projectId: string, actor: Actor, raw: unknown, direction: "undo" | "redo"): Promise<OpResult> {
  const opId = opIdOf(raw);
  if (opId) {
    const replay = await replayOf(projectId, actor.id, opId);
    if (replay) return replay;
  }
  await requireRole(projectId, actor, ["owner", "editor"]);
  const opIdValue = parseOpId(raw);
  const from = direction === "undo" ? "undo" : "redo";
  const to = direction === "undo" ? "redo" : "undo";
  const outcome = await tx<Outcome>(async (db) => {
    const locked = await loadProjectRow(db, projectId, true);
    if (!locked) throw notFound();
    const first = await one<OpRow>("SELECT * FROM ops WHERE project_id = $1 AND person_id = $2 AND op_id = $3", [projectId, actor.id, opIdValue], db);
    if (first) return { committed: { result: resultOf(first), summary: first.summary, authorId: actor.id }, replayed: true };
    await upgradeProject(db, projectId);
    const project = (await loadProjectRow(db, projectId)) ?? locked;
    const entry = await one<{ id: number; op_version: number }>(
      "SELECT id, op_version FROM undo_entries WHERE project_id = $1 AND person_id = $2 AND stack = $3 ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [projectId, actor.id, from],
      db,
    );
    if (!entry) throw new AppError(direction === "undo" ? "nothing_to_undo" : "nothing_to_redo");
    const original = await one<OpRow>("SELECT * FROM ops WHERE project_id = $1 AND version = $2", [projectId, entry.op_version], db);
    const step = direction === "undo" ? original?.inverse : original?.forward;
    if (!original || !step) throw new AppError(direction === "undo" ? "nothing_to_undo" : "nothing_to_redo");
    const timeline = await loadTimeline(db, project);
    const draft = new Draft(timeline);
    const ctx = await contextFor(db, projectId, null, timeline);
    const effect = applyStep(draft, step, ctx);
    const pins = step.k === "restore" ? await setPinFrames(db, step.pins) : [];
    const committed = await record(db, project, actor, opIdValue, direction, draft, effect, { forward: null, inverse: null }, [], pins);
    await db.query("DELETE FROM undo_entries WHERE id = $1", [entry.id]);
    await db.query("INSERT INTO undo_entries (project_id, person_id, op_version, stack) VALUES ($1,$2,$3,$4)", [projectId, actor.id, entry.op_version, to]);
    return { committed, replayed: false };
  });
  if (!outcome.replayed) announce(projectId, actor, outcome.committed);
  return outcome.committed.result;
}
