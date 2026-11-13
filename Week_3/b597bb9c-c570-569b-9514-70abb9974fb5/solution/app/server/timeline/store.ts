import type pg from "pg";
import { decimalToFraction, lengthAtSpeed, rateOf, secondsToFrames, type FrameRate } from "../../shared/rational";
import type { AspectRatio, Clip, Marker, Project } from "../../shared/types";
import { one, query, type Db } from "../db";
import { Draft, type CaptionRec, type Diff, type MediaInfo, type RowRec, type Timeline } from "./model";

export interface ProjectRow {
  id: string;
  title: string;
  agency: string;
  description: string;
  frame_rate: Project["frame_rate"];
  aspect_ratio: AspectRatio;
  time_unit: "frames" | "seconds";
  version: number;
  position: number;
  updated_at: Date;
}

interface ClipRow {
  id: string;
  row_id: string;
  name: string;
  kind: Clip["kind"];
  media_id: string | null;
  start_frame: number;
  end_frame: number;
  source_in: number;
  source_out: number;
  speed_percent: number;
  hidden: boolean;
  group_id: string | null;
  text: string | null;
  text_colour: string | null;
  box_colour: string | null;
  font_weight: number | null;
  keyframes: Clip["keyframes"];
  base: Clip["base"];
  legacy: { start: string; source_in: string; source_out: string } | null;
}

interface CaptionRow {
  id: string;
  row_id: string;
  start_frame: number;
  end_frame: number;
  text: string;
  orig_start_ms: number | null;
  orig_end_ms: number | null;
  legacy: { start: string; end: string } | null;
}

interface MarkerRow {
  frame: number;
  label: string;
  legacy: string | number | null;
}

export const framesOfSeconds = (rate: FrameRate, seconds: string | number): number => {
  const { num, den } = decimalToFraction(String(seconds));
  return secondsToFrames(rate, num, den);
};

/** A clip's frames: stored, or converted on the fly while its project is still in seconds. */
export function clipFromRow(row: ClipRow, rate: FrameRate): Clip {
  const { legacy, ...clip } = row;
  if (!legacy) return clip;
  const start = framesOfSeconds(rate, legacy.start);
  const sourceIn = framesOfSeconds(rate, legacy.source_in);
  const sourceOut = framesOfSeconds(rate, legacy.source_out);
  return {
    ...clip,
    start_frame: start,
    source_in: sourceIn,
    source_out: sourceOut,
    end_frame: start + lengthAtSpeed(sourceOut - sourceIn, clip.speed_percent),
  };
}

export function captionFromRow(row: CaptionRow, rate: FrameRate): CaptionRec {
  const { legacy, ...caption } = row;
  if (!legacy) return caption;
  return { ...caption, start_frame: framesOfSeconds(rate, legacy.start), end_frame: framesOfSeconds(rate, legacy.end) };
}

export function markerFromRow(row: MarkerRow, rate: FrameRate): Marker {
  return { frame: row.legacy === null ? row.frame : framesOfSeconds(rate, row.legacy), label: row.label };
}

export async function loadProjectRow(db: Db, id: string, lock = false): Promise<ProjectRow | undefined> {
  return one<ProjectRow>(`SELECT * FROM projects WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], db);
}

export async function loadTimeline(db: Db, project: ProjectRow): Promise<Timeline> {
  const rate = rateOf(project.frame_rate);
  const rows = await query<RowRec>("SELECT id, name, kind, position, locked, srt_eol, srt_bom FROM rows WHERE project_id = $1 ORDER BY position", [project.id], db);
  const clips = await query<ClipRow>("SELECT * FROM clips WHERE project_id = $1 ORDER BY seq", [project.id], db);
  const captions = await query<CaptionRow>("SELECT * FROM captions WHERE project_id = $1 ORDER BY start_frame, seq", [project.id], db);
  const markers = await query<MarkerRow>("SELECT frame, label, legacy FROM markers WHERE project_id = $1 ORDER BY id", [project.id], db);
  return {
    projectId: project.id,
    rate,
    aspect: project.aspect_ratio,
    rows,
    clips: clips.map((row) => clipFromRow(row, rate)),
    captions: captions.map((row) => captionFromRow(row, rate)),
    markers: markers.map((row) => markerFromRow(row, rate)).sort((a, b) => a.frame - b.frame),
  };
}

export async function loadMedia(db: Db, ids: readonly string[]): Promise<Map<string, MediaInfo>> {
  if (!ids.length) return new Map();
  const rows = await query<{
    id: string;
    name: string;
    kind: MediaInfo["kind"];
    width: number | null;
    height: number | null;
    src_num: number;
    src_den: number;
  }>("SELECT id, name, kind, width, height, src_num, src_den FROM media WHERE id = ANY($1)", [ids], db);
  return new Map(rows.map((row) => [row.id, { ...row, src_num: BigInt(row.src_num), src_den: BigInt(row.src_den) }]));
}

/** Writes a draft's differences; the project version and timestamp are bumped by the caller's op log step. */
export async function persist(db: pg.PoolClient, projectId: string, draft: Draft, diff: Diff): Promise<void> {
  for (const clip of diff.clips) {
    await db.query(
      `INSERT INTO clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out,
         speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes, base)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET row_id=$3, name=$4, kind=$5, media_id=$6, start_frame=$7, end_frame=$8, source_in=$9,
         source_out=$10, speed_percent=$11, hidden=$12, group_id=$13, text=$14, text_colour=$15, box_colour=$16,
         font_weight=$17, keyframes=$18, base=$19, legacy=NULL`,
      [
        clip.id, projectId, clip.row_id, clip.name, clip.kind, clip.media_id, clip.start_frame, clip.end_frame, clip.source_in,
        clip.source_out, clip.speed_percent, clip.hidden, clip.group_id, clip.text, clip.text_colour, clip.box_colour,
        clip.font_weight, JSON.stringify(clip.keyframes), JSON.stringify(clip.base),
      ],
    );
  }
  for (const [id, before] of diff.clipBefore) {
    if (before && !draft.clips.has(id)) await db.query("DELETE FROM clips WHERE id = $1 AND project_id = $2", [id, projectId]);
  }
  if (diff.captions.length) {
    const column = <T>(pick: (caption: CaptionRec) => T): T[] => diff.captions.map(pick);
    await db.query(
      `INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text, orig_start_ms, orig_end_ms)
       SELECT id, $1, row_id, start_frame, end_frame, text, orig_start_ms, orig_end_ms
         FROM unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::text[], $7::int[], $8::int[])
              AS cue(id, row_id, start_frame, end_frame, text, orig_start_ms, orig_end_ms)
       ON CONFLICT (id) DO UPDATE SET row_id = EXCLUDED.row_id, start_frame = EXCLUDED.start_frame, end_frame = EXCLUDED.end_frame,
         text = EXCLUDED.text, orig_start_ms = EXCLUDED.orig_start_ms, orig_end_ms = EXCLUDED.orig_end_ms, legacy = NULL`,
      [
        projectId, column((c) => c.id), column((c) => c.row_id), column((c) => c.start_frame), column((c) => c.end_frame),
        column((c) => c.text), column((c) => c.orig_start_ms), column((c) => c.orig_end_ms),
      ],
    );
  }
  const goneCaptions = [...diff.captionBefore].filter(([id, before]) => before && !draft.captions.has(id)).map(([id]) => id);
  if (goneCaptions.length) await db.query("DELETE FROM captions WHERE project_id = $1 AND id = ANY($2)", [projectId, goneCaptions]);
  for (const row of diff.rows) {
    await db.query(
      `INSERT INTO rows (id, project_id, name, kind, position, locked, srt_eol, srt_bom) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name=$3, kind=$4, position=$5, locked=$6, srt_eol=$7, srt_bom=$8`,
      [row.id, projectId, row.name, row.kind, row.position, row.locked, row.srt_eol, row.srt_bom],
    );
  }
  for (const [id, before] of diff.rowBefore) {
    if (before && !draft.rows.has(id)) await db.query("DELETE FROM rows WHERE id = $1 AND project_id = $2", [id, projectId]);
  }
  if (diff.markersBefore) {
    await db.query("DELETE FROM markers WHERE project_id = $1", [projectId]);
    for (const marker of draft.markers) {
      await db.query("INSERT INTO markers (project_id, frame, label) VALUES ($1,$2,$3)", [projectId, marker.frame, marker.label]);
    }
  }
  if (diff.aspectBefore) await db.query("UPDATE projects SET aspect_ratio = $2 WHERE id = $1", [projectId, draft.aspect]);
}
