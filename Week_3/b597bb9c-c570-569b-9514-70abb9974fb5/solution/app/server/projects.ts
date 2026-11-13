import { FIELD_ERRORS } from "../shared/copy";
import { codePoints } from "../shared/codepoints";
import { isRateLabel, rateOf } from "../shared/rational";
import { TITLE_MAX } from "../shared/limits";
import {
  ASPECTS,
  ASPECT_LABELS,
  type AspectRatio,
  type Clip,
  type MediaDims,
  type Member,
  type Project,
  type ProjectDetail,
  type Role,
} from "../shared/types";
import type { Actor } from "./access";
import { one, pool, query, tx, type Db } from "./db";
import { invalid, notFound } from "./errors";
import { newId } from "./ids";
import { publicCaption, publicRow } from "./records";
import { loadTimeline, markerFromRow, type ProjectRow } from "./timeline/store";
import { timelineLength, Draft } from "./timeline/model";

export async function clipsOf(db: Db, project: ProjectRow): Promise<Clip[]> {
  return (await loadTimeline(db, project)).clips;
}

async function projectRecord(db: Db, row: ProjectRow, role: Role): Promise<Project> {
  const timeline = await loadTimeline(db, row);
  const draft = new Draft(timeline);
  const lastCut = await one<{ id: string; name: string; total_frames: number }>(
    "SELECT id, name, total_frames FROM cuts WHERE project_id = $1 ORDER BY seq DESC LIMIT 1",
    [row.id],
    db,
  );
  return {
    id: row.id,
    title: row.title,
    agency: row.agency,
    description: row.description,
    frame_rate: row.frame_rate,
    aspect_ratio: row.aspect_ratio,
    width: ASPECTS[row.aspect_ratio].width,
    height: ASPECTS[row.aspect_ratio].height,
    time_unit: row.time_unit,
    version: row.version,
    total_frames: timelineLength(draft),
    role,
    markers: timeline.markers,
    last_cut: lastCut ?? null,
  };
}

export async function markersOf(db: Db, row: ProjectRow): Promise<{ frame: number; label: string }[]> {
  const rate = rateOf(row.frame_rate);
  const rows = await query<{ frame: number; label: string; legacy: number | null }>(
    "SELECT frame, label, legacy FROM markers WHERE project_id = $1 ORDER BY id",
    [row.id],
    db,
  );
  return rows.map((marker) => markerFromRow(marker, rate)).sort((a, b) => a.frame - b.frame);
}

/** The projects the caller can open, in seed or creation order. */
export async function listProjects(actor: Actor): Promise<Project[]> {
  const rows = await query<ProjectRow & { role: Role }>(
    actor.is_owner
      ? "SELECT p.*, 'owner' AS role FROM projects p ORDER BY p.position"
      : "SELECT p.*, m.role FROM projects p JOIN members m ON m.project_id = p.id WHERE m.person_id = $1 ORDER BY p.position",
    actor.is_owner ? [] : [actor.id],
  );
  return Promise.all(rows.map((row) => projectRecord(pool, row, row.role)));
}

export async function mediaDimsOf(db: Db, clips: readonly Clip[]): Promise<Record<string, MediaDims>> {
  const ids = [...new Set(clips.flatMap((clip) => (clip.media_id ? [clip.media_id] : [])))];
  if (!ids.length) return {};
  const rows = await query<{ id: string } & MediaDims>("SELECT id, kind, width, height, sha256 FROM media WHERE id = ANY($1)", [ids], db);
  return Object.fromEntries(rows.map(({ id, ...dims }) => [id, dims]));
}

export async function membersOf(db: Db, projectId: string): Promise<Member[]> {
  const rows = await query<{ id: string; name: string; email: string; handle: string; role: Role }>(
    `SELECT p.id, p.name, p.email, p.handle, m.role FROM members m JOIN people p ON p.id = m.person_id
      WHERE m.project_id = $1 ORDER BY m.seq`,
    [projectId],
    db,
  );
  return rows.map(({ role, ...person }) => ({ person, role }));
}

export async function projectDetail(row: ProjectRow, role: Role): Promise<ProjectDetail> {
  const timeline = await loadTimeline(pool, row);
  return {
    project: await projectRecord(pool, row, role),
    rows: timeline.rows.map(publicRow),
    clips: timeline.clips,
    captions: timeline.captions.map(publicCaption),
    members: await membersOf(pool, row.id),
    media: await mediaDimsOf(pool, timeline.clips),
  };
}

export async function createProject(actor: Actor, raw: unknown): Promise<Project> {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  const title = typeof input["title"] === "string" ? input["title"].trim() : "";
  if (!title || codePoints(title) > TITLE_MAX) errors["title"] = FIELD_ERRORS.title;
  if (!isRateLabel(input["frame_rate"])) errors["frame_rate"] = FIELD_ERRORS.frame_rate;
  if (!ASPECT_LABELS.includes(input["aspect_ratio"] as AspectRatio)) errors["aspect_ratio"] = FIELD_ERRORS.aspect_ratio;
  const agency = typeof input["agency"] === "string" ? input["agency"].trim() : "";
  const description = typeof input["description"] === "string" ? input["description"].trim() : "";
  if (codePoints(agency) > 80) errors["agency"] = FIELD_ERRORS.other;
  if (codePoints(description) > 500) errors["description"] = FIELD_ERRORS.other;
  if (Object.keys(errors).length) throw invalid(errors);
  const id = newId("p");
  const row = await tx(async (db) => {
    await db.query(
      "INSERT INTO projects (id, title, agency, description, frame_rate, aspect_ratio) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, title, agency, description, input["frame_rate"], input["aspect_ratio"]],
    );
    const rows: [string, string, number][] = [["Titles", "video", 1], ["Picture", "video", 2], ["Audio", "audio", 3], ["Captions", "caption", 4]];
    for (const [name, kind, position] of rows) {
      await db.query("INSERT INTO rows (id, project_id, name, kind, position) VALUES ($1,$2,$3,$4,$5)", [newId("r"), id, name, kind, position]);
    }
    await db.query("INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,'owner')", [id, actor.id]);
    return one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [id], db);
  });
  if (!row) throw notFound();
  return projectRecord(pool, row, "owner");
}
