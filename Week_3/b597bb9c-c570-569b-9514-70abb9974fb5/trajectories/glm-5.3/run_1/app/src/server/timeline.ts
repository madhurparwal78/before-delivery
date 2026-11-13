import type { Db } from './db';
import type { Clip, Row, Caption, Marker, Role } from '../shared/types';
import { secondsToFrames, frameRate, aspectSize, clipLength } from '../shared/frames';

/**
 * The whole timeline state of one project, loaded in one place. Every op,
 * undo, restore and export reads and writes through this model.
 */
export interface ProjectMeta {
  id: string;
  title: string;
  agency: string;
  description: string;
  frame_rate: string;
  aspect_ratio: string;
  time_unit: 'frames' | 'seconds';
  version: number;
}

export interface TimelineState {
  meta: ProjectMeta;
  rows: Row[];
  clips: Clip[];
  captions: Caption[];
  markers: Marker[];
  totalFrames: number;
  width: number;
  height: number;
}

interface RowRow {
  id: string;
  name: string;
  kind: string;
  position: number;
  locked: boolean;
}

interface ClipRow {
  id: string;
  row_id: string;
  name: string;
  kind: string;
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
  keyframes: Record<string, { frame: number; value: number; curve: string }[]>;
  add_order: number;
}

interface CaptionRow {
  id: string;
  row_id: string;
  start_frame: number;
  end_frame: number;
  text: string;
}

export function totalFramesOf(clips: readonly { end_frame: number }[], captions: readonly { end_frame: number }[]): number {
  let total = 0;
  for (const c of clips) total = Math.max(total, c.end_frame);
  for (const c of captions) total = Math.max(total, c.end_frame);
  return total;
}

export async function loadTimeline(db: Db, projectId: string): Promise<TimelineState | null> {
  const metaRes = await db.query(
    `SELECT id, title, agency, description, frame_rate, aspect_ratio, time_unit, version
     FROM projects WHERE id = $1`,
    [projectId],
  );
  if ((metaRes.rowCount ?? 0) === 0) return null;
  const m = metaRes.rows[0] as ProjectMeta;
  const rate = frameRate(m.frame_rate);
  const upgrade = m.time_unit === 'seconds';

  const rowsRes = await db.query<RowRow>(
    'SELECT id, name, kind, position, locked FROM rows WHERE project_id = $1 ORDER BY position',
    [projectId],
  );
  const clipsRes = await db.query<ClipRow>(
    'SELECT * FROM clips WHERE project_id = $1 ORDER BY add_order',
    [projectId],
  );
  const captionsRes = await db.query<CaptionRow>(
    'SELECT id, row_id, start_frame, end_frame, text FROM captions WHERE project_id = $1',
    [projectId],
  );
  const markersRes = await db.query<{ frame: number; label: string }>(
    'SELECT frame, label FROM markers WHERE project_id = $1 ORDER BY frame',
    [projectId],
  );

  const rows: Row[] = rowsRes.rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as Row['kind'],
    position: r.position,
    locked: r.locked,
  }));

  const clips: Clip[] = clipsRes.rows.map((c) => {
    // NUMERIC columns arrive as strings; every value is a number from here.
    let start = Number(c.start_frame);
    let sourceIn = Number(c.source_in);
    let sourceOut = Number(c.source_out);
    if (upgrade) {
      start = secondsToFrames(start, m.frame_rate);
      sourceIn = secondsToFrames(sourceIn, m.frame_rate);
      sourceOut = secondsToFrames(sourceOut, m.frame_rate);
    }
    const end = start + clipLength(sourceIn, sourceOut, Number(c.speed_percent));
    return {
      id: c.id,
      row_id: c.row_id,
      name: c.name,
      kind: c.kind as Clip['kind'],
      media_id: c.media_id,
      start_frame: start,
      end_frame: end,
      source_in: sourceIn,
      source_out: sourceOut,
      speed_percent: Number(c.speed_percent),
      hidden: c.hidden,
      group_id: c.group_id,
      text: c.text,
      text_colour: c.text_colour,
      box_colour: c.box_colour,
      font_weight: c.font_weight,
      keyframes: c.keyframes as Clip['keyframes'],
    };
  });

  const captions: Caption[] = captionsRes.rows.map((c) => {
    let start = Number(c.start_frame);
    let end = Number(c.end_frame);
    if (upgrade) {
      start = secondsToFrames(start, m.frame_rate);
      end = secondsToFrames(end, m.frame_rate);
    }
    return { id: c.id, row_id: c.row_id, start_frame: start, end_frame: end, text: c.text };
  });

  const markers: Marker[] = markersRes.rows.map((mk) => ({
    frame: upgrade ? secondsToFrames(Number(mk.frame), m.frame_rate) : Number(mk.frame),
    label: mk.label,
  }));

  const size = aspectSize(m.aspect_ratio);
  void rate;
  return {
    meta: m,
    rows,
    clips,
    captions,
    markers,
    totalFrames: totalFramesOf(clips, captions),
    width: size.width,
    height: size.height,
  };
}

/** The role of a person on a project, or null for a non-member. */
export async function roleOnProject(db: Db, projectId: string, personId: string): Promise<Role | null> {
  const res = await db.query<{ role: string }>(
    'SELECT role FROM members WHERE project_id = $1 AND person_id = $2',
    [projectId, personId],
  );
  if ((res.rowCount ?? 0) === 0) return null;
  const role = res.rows[0]!.role;
  return role === 'owner' || role === 'editor' || role === 'commenter' ? role : null;
}

/** Timeline order: by start frame, then row position, then clip id. */
export function timelineOrder(state: TimelineState): Clip[] {
  const rowPos = new Map(state.rows.map((r) => [r.id, r.position]));
  return [...state.clips].sort(
    (a, b) =>
      a.start_frame - b.start_frame ||
      (rowPos.get(a.row_id) ?? 0) - (rowPos.get(b.row_id) ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
