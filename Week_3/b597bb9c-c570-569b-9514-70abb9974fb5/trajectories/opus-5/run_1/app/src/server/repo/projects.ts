/**
 * Loading and saving a project's timeline. Projects still stored in seconds are
 * read in frames by the same rounding rule, so values match before and after the upgrade.
 */
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { pool } from '../db.js';
import { exactRate, secondsToFrames, type ExactRate, type FrameRateName } from '../../domain/rate.js';
import { lengthFromSource, totalFrames, type EngineCaption, type EngineClip, type EngineComment, type MediaInfo, type TimelineSnapshot, type TimelineState } from '../../domain/timeline-state.js';
import type { AspectRatio, ClipKind, ClipRecord, CommentRecord, CutRecord, Marker, ProjectRecord, Role, RowKind, RowRecord, Visibility } from '../../shared/types.js';
import { FRAME_SIZES } from '../../shared/types.js';
import type { LayerBase } from '../../domain/layers.js';

export type Db = Pool | PoolClient;

async function rows<T extends QueryResultRow>(db: Db, text: string, values: readonly unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(text, values as unknown[]);
  return result.rows;
}

export interface ProjectRow {
  id: string;
  title: string;
  agency: string;
  description: string;
  frame_rate: FrameRateName;
  aspect_ratio: AspectRatio;
  time_unit: 'frames' | 'seconds';
  version: number;
  seed_order: number;
  updated_at: Date;
}

interface ClipRow {
  id: string;
  row_id: string;
  name: string;
  kind: ClipKind;
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
  keyframes: EngineClip['keyframes'];
  base: LayerBase;
  added_seq: number;
  start_seconds: number | null;
  source_in_seconds: number | null;
  source_out_seconds: number | null;
}

interface CaptionRow {
  id: string;
  row_id: string;
  start_frame: number;
  end_frame: number;
  text: string;
  import_start_ms: number | null;
  import_end_ms: number | null;
  import_start_frame: number | null;
  import_end_frame: number | null;
  start_seconds: number | null;
  end_seconds: number | null;
}

interface MarkerRow {
  id: number;
  frame: number;
  label: string;
  seconds: number | null;
}

interface CommentRow {
  id: string;
  author_person_id: string | null;
  author_name: string;
  body: string;
  visibility: Visibility;
  parent_id: string | null;
  cut_id: string | null;
  pin_frame: number;
  pin_row_id: string | null;
  pin_clip_id: string | null;
  mentions: string[];
  pin_seconds: number | null;
  created_at: Date;
}

function engineClip(row: ClipRow, rate: ExactRate, inSeconds: boolean, media: Map<string, MediaInfo>): EngineClip {
  const clip: EngineClip = {
    id: row.id,
    row_id: row.row_id,
    name: row.name,
    kind: row.kind,
    media_id: row.media_id,
    start_frame: row.start_frame,
    end_frame: row.end_frame,
    source_in: row.source_in,
    source_out: row.source_out,
    speed_percent: row.speed_percent,
    hidden: row.hidden,
    group_id: row.group_id,
    text: row.text,
    text_colour: row.text_colour,
    box_colour: row.box_colour,
    font_weight: row.font_weight,
    keyframes: row.keyframes ?? {},
    base: row.base,
    added_seq: Number(row.added_seq),
  };
  if (!inSeconds) return clip;
  clip.start_frame = secondsToFrames(String(row.start_seconds ?? 0), rate);
  clip.source_in = secondsToFrames(String(row.source_in_seconds ?? 0), rate);
  clip.source_out = secondsToFrames(String(row.source_out_seconds ?? 0), rate);
  if (clip.kind === 'text' && row.media_id === null) {
    clip.end_frame = clip.start_frame + (clip.source_out - clip.source_in);
    return clip;
  }
  const limit = row.media_id === null ? null : media.get(row.media_id);
  if (limit) {
    clip.source_out = Math.min(clip.source_out, limit.source_frames[rate.name]);
  }
  clip.end_frame = clip.start_frame + lengthFromSource(clip.source_out - clip.source_in, clip.speed_percent);
  return clip;
}

function engineCaption(row: CaptionRow, rate: ExactRate, inSeconds: boolean): EngineCaption {
  return {
    id: row.id,
    row_id: row.row_id,
    start_frame: inSeconds ? secondsToFrames(String(row.start_seconds ?? 0), rate) : row.start_frame,
    end_frame: inSeconds ? secondsToFrames(String(row.end_seconds ?? 0), rate) : row.end_frame,
    text: row.text,
    import_start_ms: row.import_start_ms,
    import_end_ms: row.import_end_ms,
    import_start_frame: row.import_start_frame,
    import_end_frame: row.import_end_frame,
  };
}

export interface LoadedProject {
  row: ProjectRow;
  state: TimelineState;
  markers: Marker[];
  comments: CommentRow[];
}

export async function loadProjectRow(db: Db, projectId: string): Promise<ProjectRow | null> {
  const found = await rows<ProjectRow>(
    db,
    `select id, title, agency, description, frame_rate, aspect_ratio, time_unit, version, seed_order, updated_at
     from projects where id = $1`,
    [projectId],
  );
  return found.length > 0 ? found[0] : null;
}

export async function loadProject(
  db: Db,
  projectId: string,
  media: Map<string, MediaInfo>,
): Promise<LoadedProject | null> {
  const row = await loadProjectRow(db, projectId);
  if (row === null) return null;
  const rate = exactRate(row.frame_rate);
  const inSeconds = row.time_unit === 'seconds';
  const rowRecords = await rows<RowRecord & { kind: RowKind }>(
    db,
    `select id, name, kind, position, locked from project_rows where project_id = $1 order by position`,
    [projectId],
  );
  const clipRows = await rows<ClipRow>(
    db,
    `select id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out, speed_percent, hidden,
            group_id, text, text_colour, box_colour, font_weight, keyframes, base, added_seq,
            start_seconds, source_in_seconds, source_out_seconds
     from clips where project_id = $1 order by added_seq`,
    [projectId],
  );
  const captionRows = await rows<CaptionRow>(
    db,
    `select id, row_id, start_frame, end_frame, text, import_start_ms, import_end_ms, import_start_frame,
            import_end_frame, start_seconds, end_seconds
     from captions where project_id = $1 order by start_frame`,
    [projectId],
  );
  const markerRows = await rows<MarkerRow>(
    db,
    `select id, frame, label, seconds from markers where project_id = $1 order by id`,
    [projectId],
  );
  const commentRows = await rows<CommentRow>(
    db,
    `select id, author_person_id, author_name, body, visibility, parent_id, cut_id, pin_frame, pin_row_id,
            pin_clip_id, mentions, pin_seconds, created_at
     from comments where project_id = $1 order by created_at, id`,
    [projectId],
  );
  const markers: Marker[] = markerRows.map((marker) => ({
    frame: inSeconds ? secondsToFrames(String(marker.seconds ?? 0), rate) : marker.frame,
    label: marker.label,
  }));
  const comments: EngineComment[] = commentRows.map((comment) => ({
    id: comment.id,
    cut_id: comment.cut_id,
    pin_frame: inSeconds && comment.pin_seconds !== null ? secondsToFrames(String(comment.pin_seconds), rate) : comment.pin_frame,
    pin_row_id: comment.pin_row_id,
    pin_clip_id: comment.pin_clip_id,
  }));
  const state: TimelineState = {
    project: {
      id: row.id,
      title: row.title,
      frame_rate: row.frame_rate,
      aspect_ratio: row.aspect_ratio,
      version: row.version,
    },
    rows: rowRecords.map((record) => ({ ...record })),
    clips: clipRows.map((clip) => engineClip(clip, rate, inSeconds, media)),
    captions: captionRows.map((caption) => engineCaption(caption, rate, inSeconds)),
    markers,
    comments,
  };
  return { row, state, markers, comments: commentRows };
}

export function publicClip(clip: EngineClip): ClipRecord & { base: LayerBase } {
  return {
    id: clip.id,
    row_id: clip.row_id,
    name: clip.name,
    kind: clip.kind,
    media_id: clip.media_id,
    start_frame: clip.start_frame,
    end_frame: clip.end_frame,
    source_in: clip.source_in,
    source_out: clip.source_out,
    speed_percent: clip.speed_percent,
    hidden: clip.hidden,
    group_id: clip.group_id,
    text: clip.text,
    text_colour: clip.text_colour,
    box_colour: clip.box_colour,
    font_weight: clip.font_weight,
    keyframes: clip.keyframes,
    base: clip.base,
  };
}

export function publicCaption(caption: EngineCaption): {
  id: string;
  row_id: string;
  start_frame: number;
  end_frame: number;
  text: string;
} {
  return {
    id: caption.id,
    row_id: caption.row_id,
    start_frame: caption.start_frame,
    end_frame: caption.end_frame,
    text: caption.text,
  };
}

export function projectTotalFrames(state: TimelineState): number {
  return totalFrames(state.clips, state.captions);
}

export function projectRecord(
  loaded: LoadedProject,
  role: Role,
  lastCut: { id: string; name: string; total_frames: number } | null,
): ProjectRecord {
  const size = FRAME_SIZES[loaded.row.aspect_ratio];
  return {
    id: loaded.row.id,
    title: loaded.row.title,
    agency: loaded.row.agency,
    description: loaded.row.description,
    frame_rate: loaded.row.frame_rate,
    aspect_ratio: loaded.row.aspect_ratio,
    width: size.width,
    height: size.height,
    time_unit: loaded.row.time_unit,
    version: loaded.row.version,
    total_frames: projectTotalFrames(loaded.state),
    role,
    markers: loaded.markers,
    last_cut: lastCut,
  };
}

/**
 * A pin's live frame: the clip's current start plus the pin's offset from that
 * clip's start in the cut, or the stored frame if the clip no longer exists.
 */
export function liveFrame(
  comment: { cut_id: string | null; pin_frame: number; pin_clip_id: string | null },
  clips: readonly EngineClip[],
  snapshots: Map<string, TimelineSnapshot>,
): number {
  if (comment.pin_clip_id === null) return comment.pin_frame;
  const clip = clips.find((candidate) => candidate.id === comment.pin_clip_id);
  if (!clip) return comment.pin_frame;
  if (comment.cut_id === null) return comment.pin_frame;
  const snapshot = snapshots.get(comment.cut_id);
  const inCut = snapshot?.clips.find((candidate) => candidate.id === comment.pin_clip_id);
  if (!inCut) return comment.pin_frame;
  return clip.start_frame + (comment.pin_frame - inCut.start_frame);
}

export function commentRecord(
  row: CommentRow,
  clips: readonly EngineClip[],
  snapshots: Map<string, TimelineSnapshot>,
  rate: ExactRate,
): CommentRecord {
  const pinFrame = row.pin_seconds !== null ? secondsToFrames(String(row.pin_seconds), rate) : row.pin_frame;
  const pin = { cut_id: row.cut_id, pin_frame: pinFrame, pin_clip_id: row.pin_clip_id };
  return {
    id: row.id,
    author_name: row.author_name,
    body: row.body,
    visibility: row.visibility,
    parent_id: row.parent_id,
    cut_id: row.cut_id,
    pin: {
      frame: pinFrame,
      row_id: row.pin_row_id,
      clip_id: row.pin_clip_id,
      live_frame: liveFrame(pin, clips, snapshots),
    },
    mentions: row.mentions,
    created_at: row.created_at.toISOString(),
  };
}

export async function loadSnapshots(db: Db, projectId: string): Promise<Map<string, TimelineSnapshot>> {
  const cuts = await rows<{ id: string; snapshot: TimelineSnapshot }>(
    db,
    `select id, snapshot from cuts where project_id = $1`,
    [projectId],
  );
  return new Map(cuts.map((cut) => [cut.id, cut.snapshot]));
}

export async function loadCuts(db: Db, projectId: string): Promise<CutRecord[]> {
  const cuts = await rows<{
    id: string;
    name: string;
    version: number;
    total_frames: number;
    shared: boolean;
    created_at: Date;
  }>(
    db,
    `select id, name, version, total_frames, shared, created_at from cuts where project_id = $1 order by created_at, id`,
    [projectId],
  );
  const approvals = await rows<{ cut_id: string; name: string; at: Date }>(
    db,
    `select cut_id, name, at from cut_approvals where cut_id in (select id from cuts where project_id = $1) order by at`,
    [projectId],
  );
  return cuts.map((cut) => ({
    id: cut.id,
    name: cut.name,
    version: cut.version,
    total_frames: cut.total_frames,
    shared: cut.shared,
    approvals: approvals
      .filter((approval) => approval.cut_id === cut.id)
      .map((approval) => ({ name: approval.name, at: approval.at.toISOString() })),
    created_at: cut.created_at.toISOString(),
  }));
}

export async function loadRole(db: Db, projectId: string, personId: string): Promise<Role | null> {
  const found = await rows<{ role: Role; is_owner: boolean }>(
    db,
    `select m.role, p.is_owner from members m join people p on p.id = m.person_id
     where m.project_id = $1 and m.person_id = $2`,
    [projectId, personId],
  );
  if (found.length === 0) {
    const owner = await rows<{ id: string }>(db, `select id from people where id = $1 and is_owner = true`, [personId]);
    return owner.length > 0 ? 'owner' : null;
  }
  return found[0].is_owner ? 'owner' : found[0].role;
}

export async function projectsFor(personId: string, isOwner: boolean): Promise<{ row: ProjectRow; role: Role }[]> {
  const found = isOwner
    ? await rows<ProjectRow>(
        pool,
        `select id, title, agency, description, frame_rate, aspect_ratio, time_unit, version, seed_order, updated_at
         from projects order by seed_order, created_at`,
      )
    : await rows<ProjectRow & { role: Role }>(
        pool,
        `select p.id, p.title, p.agency, p.description, p.frame_rate, p.aspect_ratio, p.time_unit, p.version,
                p.seed_order, p.updated_at, m.role
         from projects p join members m on m.project_id = p.id
         where m.person_id = $1 order by p.seed_order, p.created_at`,
        [personId],
      );
  return found.map((row) => ({ row, role: isOwner ? 'owner' : ((row as ProjectRow & { role: Role }).role) }));
}

export { pool };
