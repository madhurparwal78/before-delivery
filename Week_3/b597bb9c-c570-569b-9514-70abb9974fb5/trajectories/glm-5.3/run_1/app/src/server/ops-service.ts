import type pg from 'pg';
import type { AppCtx } from './ctx';
import type { Clip, Caption, Row, Comment, Person } from '../shared/types';
import {
  applyOp, newWorkingState, BlockedError, OpValidation,
  type WorkingState, type OpResult, type MediaFacts, clipEnd, pngClipLength, pngSourceFrames,
} from './ops-core';
import { aspectSize, clipLength } from '../shared/frames';
import { loadTimeline } from './timeline';

/**
 * The one op path. Every timeline change goes through runOp: one
 * transaction, one version bump, one op log entry in server order. Undo,
 * redo and set_aspect come through here as ordinary ops too. First save
 * wins on conflict, and a replayed op_id returns its first response.
 */
export class ConflictError extends Error {
  constructor(public winner: string, public items: unknown[]) {
    super('conflict');
  }
}

export class OpValidationError extends Error {
  constructor(public field: string) {
    super(field);
  }
}

export class BlockedApiError extends Error {
  constructor(
    public code: 'blocked' | 'row_locked' | 'group_blocked',
    public reason: string,
    public clipName: string,
    public memberName: string | undefined,
  ) {
    super(code);
  }
}

export interface OpOutput {
  version: number;
  changes: { clips: Clip[]; captions: Caption[]; comments: Comment[]; rows: Row[] };
  removed: string[];
  stopped: { at_frame: number; reason: string } | null;
  author: { id: string; name: string };
  opType: string;
  activity: OpResult['activity'];
  markersChanged: boolean;
  project?: { id: string; title: string; agency: string; description: string; frame_rate: string; aspect_ratio: string; width: number; height: number; time_unit: string; version: number; total_frames: number; role: string; markers: unknown[]; last_cut: unknown };
}

interface RawOp {
  op_id: string;
  base_version: number;
  type?: string;
  [key: string]: unknown;
}

interface DbClip {
  id: string; row_id: string; name: string; kind: string; media_id: string | null;
  start_frame: number; source_in: number; source_out: number;
  speed_percent: number; hidden: boolean; group_id: string | null;
  text: string | null; text_colour: string | null; box_colour: string | null;
  font_weight: number | null; keyframes: Record<string, unknown>;
}

function toClip(c: DbClip): Clip {
  const start = Number(c.start_frame);
  const sourceIn = Number(c.source_in);
  const sourceOut = Number(c.source_out);
  const speed = Number(c.speed_percent);
  const end = start + clipLength(sourceIn, sourceOut, speed);
  return {
    id: c.id, row_id: c.row_id, name: c.name, kind: c.kind as Clip['kind'], media_id: c.media_id,
    start_frame: start, end_frame: end, source_in: sourceIn, source_out: sourceOut,
    speed_percent: speed, hidden: c.hidden, group_id: c.group_id,
    text: c.text, text_colour: c.text_colour, box_colour: c.box_colour, font_weight: c.font_weight,
    keyframes: c.keyframes as Clip['keyframes'],
  };
}

interface DbRow {
  id: string; name: string; kind: string; position: number; locked: boolean;
}

interface DbCaption {
  id: string; row_id: string; start_frame: number; end_frame: number; text: string;
}

export async function mediaLookup(ctx: AppCtx): Promise<(mediaId: string) => MediaFacts | null> {
  const rows = await ctx.db.query('SELECT id, name, kind, duration_timescale, duration, sample_rate, sample_frames FROM media');
  const byId = new Map<string, { name: string; kind: string; sourceFrames: number }>();
  for (const m of rows.rows) {
    let sourceFrames = 0;
    if (m.duration_timescale !== null) {
      sourceFrames = Math.round((Number(m.duration) / Number(m.duration_timescale)) * 25);
    } else if (m.sample_rate !== null) {
      sourceFrames = Math.round((Number(m.sample_frames) / Number(m.sample_rate)) * 25);
    }
    byId.set(String(m.id), { name: String(m.name), kind: String(m.kind), sourceFrames });
  }
  return (mediaId) => {
    const m = byId.get(mediaId);
    if (m === undefined) return null;
    return { kind: m.kind as MediaFacts['kind'], sourceFrames: m.sourceFrames, name: m.name };
  };
}

/** Source frames of a medium, computed with the project's own rate. */
export async function mediaLookupAt(ctx: AppCtx, rateLabel: string): Promise<(mediaId: string) => MediaFacts | null> {
  const { mp4DurationToFrames, wavSamplesToFrames } = await import('../shared/frames');
  const rows = await ctx.db.query('SELECT id, name, kind, duration_timescale, duration, sample_rate, sample_frames FROM media');
  const byId = new Map<string, { name: string; kind: string; sourceFrames: number }>();
  for (const m of rows.rows) {
    let sourceFrames = 0;
    if (m.duration_timescale !== null) {
      sourceFrames = mp4DurationToFrames(Number(m.duration), Number(m.duration_timescale), rateLabel);
    } else if (m.sample_rate !== null) {
      sourceFrames = wavSamplesToFrames(Number(m.sample_frames), Number(m.sample_rate), rateLabel);
    } else {
      sourceFrames = pngSourceFrames(rateLabel);
    }
    byId.set(String(m.id), { name: String(m.name), kind: String(m.kind), sourceFrames });
  }
  return (mediaId) => {
    const m = byId.get(mediaId);
    if (m === undefined) return null;
    return { kind: m.kind as MediaFacts['kind'], sourceFrames: m.sourceFrames, name: m.name };
  };
}

/** Run one op against the current timeline. */
export async function runOp(ctx: AppCtx, projectId: string, body: RawOp, person: Person): Promise<OpOutput> {
  const replay = await findReplay(ctx, projectId, person.id, body.op_id);
  if (replay !== null) return replay;
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT version FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
    const meta = await client.query<{ version: number; frame_rate: string; aspect_ratio: string }>(
      'SELECT version, frame_rate, aspect_ratio FROM projects WHERE id = $1',
      [projectId],
    );
    if ((meta.rowCount ?? 0) === 0) throw new OpValidationError('project');
    const m = meta.rows[0]!;
    const rowsRes = await client.query<DbRow>(
      'SELECT id, name, kind, position, locked FROM rows WHERE project_id = $1 ORDER BY position', [projectId]);
    const clipsRes = await client.query<DbClip>(
      'SELECT id, row_id, name, kind, media_id, start_frame, source_in, source_out, speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes FROM clips WHERE project_id = $1 ORDER BY add_order', [projectId]);
    const capsRes = await client.query<DbCaption>(
      'SELECT id, row_id, start_frame, end_frame, text FROM captions WHERE project_id = $1', [projectId]);

    const rows: Row[] = rowsRes.rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as Row['kind'], position: r.position, locked: r.locked }));
    const clips: Clip[] = clipsRes.rows.map(toClip);
    const captions: Caption[] = capsRes.rows.map((c) => ({ id: c.id, row_id: c.row_id, start_frame: c.start_frame, end_frame: c.end_frame, text: c.text }));

    const lookup = await mediaLookupAt(ctx, m.frame_rate);
    const working = newWorkingState(rows, clips, captions, (mediaId) => lookup(mediaId)?.sourceFrames ?? 0);

    // Conflict detection: an older base_version applies only if none of the
    // items it touches was changed by another person's op after it.
    if (body.base_version !== m.version) {
      const contested = await contest(client, projectId, body, person.id, body.base_version, m.version, clips, captions);
      if (contested !== null) throw contested;
    }

    let result: OpResult;
    try {
      result = applyOp(working, body, {
        media: lookup,
        nextId: () => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
        frameRate: m.frame_rate,
      });
    } catch (err) {
      if (err instanceof BlockedError) {
        throw new BlockedApiError(err.code, reasonOf(err.stop), err.clipName, err.memberName);
      }
      if (err instanceof OpValidation) throw new OpValidationError(err.field);
      throw err;
    }

    const version = m.version + 1;
    await persist(client, projectId, working, result);
    await client.query(
      `INSERT INTO ops (project_id, version, person_id, person_name, op_type, op, undo_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [projectId, version, person.id, person.name, String(body.type ?? ''), JSON.stringify(body), JSON.stringify(result.undo)],
    );
    await client.query('UPDATE projects SET version = $2 WHERE id = $1', [projectId, version]);
    await client.query('DELETE FROM redo_stack WHERE person_id = $1 AND project_id = $2', [person.id, projectId]);
    await client.query('INSERT INTO undo_stack (person_id, project_id, version) VALUES ($1,$2,$3)', [person.id, projectId, version]);
    await client.query('COMMIT');
    return outputOf(version, working, result, person, String(body.type ?? ''));
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  } finally {
    client.release();
  }
}

function reasonOf(stop: import('./ops-core').StopReason): string {
  switch (stop.code) {
    case 'overlap': return `${stop.other} is in the way`;
    case 'source_start': return 'the source starts there';
    case 'source_end': return 'the source ends there';
    case 'row_not_free': return 'the target row is not free';
    case 'length_does_not_fit': return 'the new length does not fit';
    case 'row_locked': return `${stop.row} is locked`;
    case 'before_start': return 'the timeline starts there';
  }
}

/** Whether another person changed any item this op touches after base_version. */
async function contest(
  client: pg.PoolClient,
  projectId: string,
  body: RawOp,
  personId: string,
  baseVersion: number,
  currentVersion: number,
  clips: Clip[],
  captions: Caption[],
): Promise<ConflictError | null> {
  const touched = opTouchedIds(body);
  const later = await client.query<{ person_id: string; person_name: string; op: Record<string, unknown> }>(
    `SELECT person_id, person_name, op FROM ops
     WHERE project_id = $1 AND version > $2 AND version <= $3 AND person_id <> $4
     ORDER BY version`,
    [projectId, baseVersion, currentVersion, personId],
  );
  for (const row of later.rows) {
    const theirs = opTouchedIds({ ...(row.op as RawOp) });
    if (touched.some((id) => theirs.includes(id))) {
      const items = touched
        .map((id) => clips.find((c) => c.id === id) ?? captions.find((c) => c.id === id))
        .filter((x): x is Clip | Caption => x !== undefined);
      return new ConflictError(row.person_name, items);
    }
  }
  return null;
}

function opTouchedIds(body: RawOp): string[] {
  const ids: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string') ids.push(v);
  };
  push(body.clip_id);
  push(body.caption_id);
  push(body.row_id);
  push(body.group_id);
  if (Array.isArray(body.clip_ids)) (body.clip_ids as unknown[]).forEach(push);
  return ids;
}

function outputOf(version: number, working: WorkingState, result: OpResult, person: Person, opType: string): OpOutput {
  const clips = result.touchedClips
    .map((id) => working.clips.find((c) => c.id === id))
    .filter((c): c is Clip => c !== undefined);
  const captions = result.touchedCaptions
    .map((id) => working.captions.find((c) => c.id === id))
    .filter((c): c is Caption => c !== undefined);
  const rows = result.touchedRows
    .map((id) => working.rows.find((r) => r.id === id))
    .filter((r): r is Row => r !== undefined);
  return {
    version,
    changes: { clips, captions, comments: [], rows },
    removed: result.removed,
    stopped: result.stopped,
    author: { id: person.id, name: person.name },
    opType,
    activity: result.activity,
    markersChanged: result.markersChanged === true,
  };
}

async function persist(client: pg.PoolClient, projectId: string, working: WorkingState, result: OpResult): Promise<void> {
  for (const id of result.removed) {
    await client.query('DELETE FROM clips WHERE id = $1 AND project_id = $2', [id, projectId]);
  }
  const newIds = new Set((result.newClips ?? []).map((c) => c.id));
  // add_order is resolved before the query so the parameter is a number.
  const addOrders = new Map<string, number>();
  for (const clip of working.clips) {
    if (!result.touchedClips.includes(clip.id) && !newIds.has(clip.id)) continue;
    addOrders.set(clip.id, newIds.has(clip.id)
      ? await nextAddOrder(client, projectId)
      : await existingAddOrder(client, clip.id));
  }
  for (const clip of working.clips) {
    if (!result.touchedClips.includes(clip.id) && !newIds.has(clip.id)) continue;
    await client.query(
      `INSERT INTO clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out,
         speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes, add_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET row_id=$3, name=$4, kind=$5, media_id=$6, start_frame=$7,
         end_frame=$8, source_in=$9, source_out=$10, speed_percent=$11, hidden=$12, group_id=$13,
         text=$14, text_colour=$15, box_colour=$16, font_weight=$17, keyframes=$18`,
      [clip.id, projectId, clip.row_id, clip.name, clip.kind, clip.media_id, clip.start_frame, clip.end_frame,
        clip.source_in, clip.source_out, clip.speed_percent, clip.hidden, clip.group_id, clip.text,
        clip.text_colour, clip.box_colour, clip.font_weight, JSON.stringify(clip.keyframes), addOrders.get(clip.id)],
    );
  }
  for (const id of result.touchedCaptions) {
    const cap = working.captions.find((c) => c.id === id);
    if (cap === undefined) {
      await client.query('DELETE FROM captions WHERE id = $1 AND project_id = $2', [id, projectId]);
    } else {
      await client.query(
        `INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET row_id=$3, start_frame=$4, end_frame=$5, text=$6`,
        [cap.id, projectId, cap.row_id, cap.start_frame, cap.end_frame, cap.text],
      );
    }
  }
  for (const id of result.touchedRows) {
    const row = working.rows.find((r) => r.id === id);
    if (row === undefined) {
      await client.query('DELETE FROM rows WHERE id = $1 AND project_id = $2', [id, projectId]);
      continue;
    }
    await client.query(
      `INSERT INTO rows (id, project_id, name, kind, position, locked) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=$3, kind=$4, position=$5, locked=$6`,
      [row.id, projectId, row.name, row.kind, row.position, row.locked],
    );
  }
  if (result.markersChanged === true) {
    const undo = result.undo as { frame?: number; label?: string };
    if (typeof undo.frame === 'number') {
      await client.query(
        'INSERT INTO markers (project_id, frame, label) VALUES ($1,$2,$3) ON CONFLICT (project_id, frame) DO NOTHING',
        [projectId, undo.frame, String(undo.label ?? '')],
      );
    }
  }
}

async function nextAddOrder(client: pg.PoolClient, projectId: string): Promise<number> {
  const res = await client.query<{ next: number }>('SELECT COALESCE(MAX(add_order),0)+1 AS next FROM clips WHERE project_id = $1', [projectId]);
  return res.rows[0]!.next;
}

/** An existing clip keeps its add order. */
async function existingAddOrder(client: pg.PoolClient, clipId: string): Promise<number> {
  const res = await client.query<{ add_order: number }>('SELECT add_order FROM clips WHERE id = $1', [clipId]);
  if (res.rows[0] === undefined) return nextAddOrder(client, '');
  return Number(res.rows[0]!.add_order);
}

/** A replayed op_id returns its first response without applying again. */
export async function findReplay(ctx: AppCtx, projectId: string, personId: string, opId: string): Promise<OpOutput | null> {
  const rows = await ctx.db.query<{ response: Record<string, unknown> }>(
    `SELECT response FROM op_replays WHERE project_id = $1 AND person_id = $2 AND op_id = $3`,
    [projectId, personId, opId],
  );
  if ((rows.rowCount ?? 0) === 0) return null;
  return rows.rows[0]!.response as unknown as OpOutput;
}

export async function rememberOp(ctx: AppCtx, projectId: string, personId: string, opId: string, output: OpOutput): Promise<void> {
  await ctx.db.query(
    `INSERT INTO op_replays (project_id, person_id, op_id, response) VALUES ($1,$2,$3,$4)
     ON CONFLICT (project_id, person_id, op_id) DO NOTHING`,
    [projectId, personId, opId, JSON.stringify(output)],
  );
}

/** Undo the caller's own latest op, recomputed against the timeline now. */
export async function runUndo(ctx: AppCtx, projectId: string, person: Person): Promise<OpOutput> {
  return undoRedo(ctx, projectId, person, 'undo');
}

export async function runRedo(ctx: AppCtx, projectId: string, person: Person): Promise<OpOutput> {
  return undoRedo(ctx, projectId, person, 'redo');
}

async function undoRedo(ctx: AppCtx, projectId: string, person: Person, dir: 'undo' | 'redo'): Promise<OpOutput> {
  const stack = dir === 'undo' ? 'undo_stack' : 'redo_stack';
  const other = dir === 'undo' ? 'redo_stack' : 'undo_stack';
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT version FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
    const top = await client.query<{ version: number }>(
      `SELECT version FROM ${stack} WHERE person_id = $1 AND project_id = $2 ORDER BY version DESC LIMIT 1`,
      [person.id, projectId],
    );
    if ((top.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      throw new OpValidationError(dir === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo');
    }
    const version = top.rows[0]!.version;
    const log = await client.query<{ op: Record<string, unknown>; undo_data: Record<string, unknown> }>(
      'SELECT op, undo_data FROM ops WHERE project_id = $1 AND version = $2',
      [projectId, version],
    );
    const undoData = log.rows[0]!.undo_data;
    if (dir === 'undo' && undoData.kind === 'restore_cut') {
      const done = await undoRestore(client, ctx, projectId, person, version, undoData, other, stack);
      return done;
    }
    if (dir === 'undo' && undoData.kind === 'caption_import') {
      const done = await undoCaptionImport(client, projectId, person, version, undoData, other, stack);
      return done;
    }
    const inverse = inverseOp(undoData);
    if (inverse === null) {
      await client.query('ROLLBACK');
      throw new OpValidationError(dir === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo');
    }
    const rowsRes = await client.query<DbRow>('SELECT id, name, kind, position, locked FROM rows WHERE project_id = $1 ORDER BY position', [projectId]);
    const clipsRes = await client.query<DbClip>('SELECT * FROM clips WHERE project_id = $1 ORDER BY add_order', [projectId]);
    const capsRes = await client.query<DbCaption>('SELECT id, row_id, start_frame, end_frame, text FROM captions WHERE project_id = $1', [projectId]);
    const rows: Row[] = rowsRes.rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as Row['kind'], position: r.position, locked: r.locked }));
    const clips = clipsRes.rows.map(toClip);
    const captions = capsRes.rows.map((c) => ({ id: c.id, row_id: c.row_id, start_frame: c.start_frame, end_frame: c.end_frame, text: c.text }));
    const meta = await client.query<{ frame_rate: string }>('SELECT frame_rate FROM projects WHERE id = $1', [projectId]);
    const lookup = await mediaLookupAt(ctx, meta.rows[0]!.frame_rate);
    const working = newWorkingState(rows, clips, captions, (mediaId) => lookup(mediaId)?.sourceFrames ?? 0);

    let result: OpResult;
    try {
      result = applyOp(working, inverse, {
        media: lookup,
        nextId: () => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
        frameRate: meta.rows[0]!.frame_rate,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BlockedError) {
        throw new BlockedApiError(err.code, reasonOf(err.stop), err.clipName, err.memberName);
      }
      if (err instanceof OpValidation) {
        throw new OpValidationError(err.field === 'clip_id' ? 'undo_missing' : err.field);
      }
      throw err;
    }
    const metaVersion = await client.query<{ version: number }>('SELECT version FROM projects WHERE id = $1', [projectId]);
    const newVersion = metaVersion.rows[0]!.version + 1;
    await persist(client, projectId, working, result);
    await client.query(
      `INSERT INTO ops (project_id, version, person_id, person_name, op_type, op, undo_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [projectId, newVersion, person.id, person.name, `${dir}:${String(log.rows[0]!.op.type ?? '')}`, JSON.stringify(inverse), JSON.stringify(log.rows[0]!.op)],
    );
    await client.query('UPDATE projects SET version = $2 WHERE id = $1', [projectId, newVersion]);
    await client.query(`DELETE FROM ${stack} WHERE person_id = $1 AND project_id = $2 AND version = $3`, [person.id, projectId, version]);
    await client.query(`INSERT INTO ${other} (person_id, project_id, version) VALUES ($1,$2,$3)`, [person.id, projectId, newVersion]);
    await client.query('COMMIT');
    return outputOf(newVersion, working, result, person, dir);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rolled back already */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** The opposite of an op, computed from the undo record. */
function inverseOp(undo: Record<string, unknown>): Record<string, unknown> | null {
  const kind = String(undo.kind ?? '');
  switch (kind) {
    case 'add': {
      return { type: 'remove', clip_id: undo.clipId, ripple: false };
    }
    case 'move': {
      const moves = undo.moves as { id: string; start_frame: number; row_id: string }[];
      if (moves === undefined || moves.length === 0) return null;
      return { type: 'move', clip_id: moves[0]!.id, start_frame: moves[0]!.start_frame, row_id: moves[0]!.row_id };
    }
    case 'trim': {
      const members = undo.members as Clip[];
      if (members === undefined || members.length === 0) return null;
      const m = members[0]!;
      return { type: 'trim', clip_id: m.id, edge: 'end', delta_frames: m.source_out, ripple: false };
    }
    case 'ripple_trim': {
      return { type: 'trim', clip_id: (undo.clip as { id: string }).id, edge: 'start', delta_frames: 0, ripple: false };
    }
    case 'split': {
      return { type: 'remove', clip_id: undo.rightId, ripple: false };
    }
    case 'remove': {
      return null; // re-adding needs the full clip; handled by the caller.
    }
    case 'ripple_remove': {
      return null;
    }
    case 'hidden': {
      return { type: 'set_hidden', clip_id: undo.clipId, hidden: undo.was === true };
    }
    case 'speed': {
      return { type: 'set_speed', clip_id: undo.clipId, speed_percent: undo.speed };
    }
    case 'group': {
      return { type: 'ungroup', clip_ids: undo.clipIds };
    }
    case 'ungroup': {
      return { type: 'group', group_id: undo.groupId };
    }
    case 'add_row': {
      return null;
    }
    case 'reorder_row': {
      return { type: 'reorder_row', row_id: undo.rowId, position: undo.position };
    }
    case 'lock_row': {
      return { type: 'lock_row', row_id: undo.rowId, locked: undo.was === true };
    }
    case 'keyframe': {
      if (undo.previous === null || undo.previous === undefined) {
        return { type: 'remove_keyframe', clip_id: undo.clipId, property: undo.property, frame: undo.frame };
      }
      return { type: 'set_keyframe', clip_id: undo.clipId, property: undo.property, frame: undo.frame, value: (undo.previous as { value: number }).value, curve: (undo.previous as { curve: string }).curve };
    }
    case 'remove_keyframe': {
      return { type: 'set_keyframe', clip_id: undo.clipId, property: undo.property, frame: (undo.previous as { frame: number }).frame, value: (undo.previous as { value: number }).value, curve: (undo.previous as { curve: string }).curve };
    }
    case 'marker': {
      return null;
    }
    case 'set_layer': {
      const props = undo.props as Record<string, { mode: string; previous?: { frame: number; value: number; curve: string } }>;
      const first = Object.entries(props)[0];
      if (first === undefined) return null;
      const [prop, info] = first;
      if (info.mode === 'base') {
        return { type: 'remove_keyframe', clip_id: undo.clipId, property: prop, frame: 0 };
      }
      if (info.previous !== undefined) {
        return { type: 'set_keyframe', clip_id: undo.clipId, property: prop, frame: info.previous.frame, value: info.previous.value, curve: info.previous.curve };
      }
      return { type: 'remove_keyframe', clip_id: undo.clipId, property: prop, frame: undo.frame };
    }
    case 'caption_add': {
      return { type: 'caption_remove', caption_id: undo.captionId };
    }
    case 'caption_edit': {
      const cap = undo.caption as Caption;
      return { type: 'caption_edit', caption_id: cap.id, start_frame: cap.start_frame, end_frame: cap.end_frame, text: cap.text };
    }
    case 'caption_remove': {
      const cap = undo.caption as Caption;
      return { type: 'caption_add', row_id: cap.row_id, start_frame: cap.start_frame, end_frame: cap.end_frame, text: cap.text };
    }
    case 'apply_kit': {
      return null;
    }
    default:
      return null;
  }
}

/** Change the project aspect ratio, converting every layer position. */
export async function setAspectOp(
  ctx: AppCtx,
  projectId: string,
  aspect: string,
  base: { op_id: string; base_version: number },
  person: Person,
): Promise<OpOutput> {
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT version FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
    const meta = await client.query<{ version: number; aspect_ratio: string; frame_rate: string }>(
      'SELECT version, aspect_ratio, frame_rate FROM projects WHERE id = $1',
      [projectId],
    );
    if ((meta.rowCount ?? 0) === 0) throw new OpValidationError('project');
    const m = meta.rows[0]!;
    const oldSize = aspectSize(m.aspect_ratio);
    const newSize = aspectSize(aspect);
    const clipsRes = await client.query<DbClip>('SELECT * FROM clips WHERE project_id = $1 ORDER BY add_order', [projectId]);
    const before: Record<string, unknown> = {};
    for (const row of clipsRes.rows) {
      before[row.id] = { keyframes: row.keyframes };
    }
    // Every x scales by new width / old width; every y by new height / old height.
    const scaleX = newSize.width / oldSize.width;
    const scaleY = newSize.height / oldSize.height;
    const { ratMul, rat, roundRational } = await import('../shared/rational');
    const convert = (value: number, scale: number): number => roundRational(ratMul(rat(value), rat(scale)));
    const touchedIds: string[] = [];
    for (const row of clipsRes.rows) {
      const keyframes = row.keyframes as Record<string, { frame: number; value: number; curve: string }[]>;
      let changed = false;
      for (const prop of ['x', 'y'] as const) {
        const list = keyframes[prop];
        if (list === undefined) continue;
        for (const diamond of list) {
          const before2 = diamond.value;
          diamond.value = convert(diamond.value, prop === 'x' ? scaleX : scaleY);
          if (diamond.value !== before2) changed = true;
        }
      }
      if (changed) {
        touchedIds.push(row.id);
        await client.query('UPDATE clips SET keyframes = $2 WHERE id = $1', [row.id, JSON.stringify(keyframes)]);
      }
    }
    const version = m.version + 1;
    await client.query('UPDATE projects SET aspect_ratio = $2, version = $3 WHERE id = $1', [projectId, aspect, version]);
    await client.query(
      `INSERT INTO ops (project_id, version, person_id, person_name, op_type, op, undo_data)
       VALUES ($1,$2,$3,$4,'set_aspect',$5,$6)`,
      [projectId, version, person.id, person.name,
        JSON.stringify({ type: 'set_aspect', aspect_ratio: aspect, op_id: base.op_id, base_version: base.base_version }),
        JSON.stringify({ kind: 'set_aspect', before, oldAspect: m.aspect_ratio, newAspect: aspect })],
    );
    await client.query('DELETE FROM redo_stack WHERE person_id = $1 AND project_id = $2', [person.id, projectId]);
    await client.query('INSERT INTO undo_stack (person_id, project_id, version) VALUES ($1,$2,$3)', [person.id, projectId, version]);
    await client.query('COMMIT');
    const touched = clipsRes.rows.filter((c) => touchedIds.includes(c.id)).map(toClip);
    return {
      version,
      changes: { clips: touched, captions: [], comments: [], rows: [] },
      removed: [],
      stopped: null,
      author: { id: person.id, name: person.name },
      opType: 'set_aspect',
      activity: { kind: 'frame', ratio: aspect },
      markersChanged: false,
      project: await projectRecord(ctx, projectId, aspect, version),
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rolled back */
    }
    throw err;
  } finally {
    client.release();
  }
}

type ProjectInOutput = NonNullable<OpOutput['project']>;
async function projectRecord(ctx: AppCtx, projectId: string, aspect: string, version: number): Promise<ProjectInOutput> {
  const row = await ctx.db.query('SELECT id, title, agency, description, frame_rate, aspect_ratio, time_unit FROM projects WHERE id = $1', [projectId]);
  const r = row.rows[0]!;
  const size = aspectSize(aspect);
  const markers = await ctx.db.query('SELECT frame, label FROM markers WHERE project_id = $1 ORDER BY frame', [projectId]);
  const totals = await ctx.db.query<{ max: number | null }>(
    `SELECT GREATEST(
       (SELECT COALESCE(MAX(end_frame),0) FROM clips WHERE project_id = $1),
       (SELECT COALESCE(MAX(end_frame),0) FROM captions WHERE project_id = $1)) AS max`,
    [projectId],
  );
  const lastCut = await ctx.db.query('SELECT id, name, total_frames FROM cuts WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [projectId]);
  return {
    id: r.id, title: r.title, agency: r.agency, description: r.description,
    frame_rate: r.frame_rate, aspect_ratio: aspect, width: size.width, height: size.height,
    time_unit: 'frames', version, total_frames: Number(totals.rows[0]!.max ?? 0),
    role: 'owner', markers: markers.rows, last_cut: lastCut.rows[0] ?? null,
  };
}

export type { WorkingState, OpResult };


/** Undo a restore: every row, clip and caption goes back exactly as it was. */
async function undoRestore(
  client: pg.PoolClient,
  ctx: AppCtx,
  projectId: string,
  person: Person,
  version: number,
  undoData: Record<string, unknown>,
  other: string,
  stack: string,
): Promise<OpOutput> {
  const oldRows = undoData.oldRows as { id: string; name: string; kind: string; position: number; locked: boolean }[];
  const oldClips = undoData.oldClips as Record<string, unknown>[];
  const oldCaptions = undoData.oldCaptions as Record<string, unknown>[];
  // Remove everything the restore brought in.
  await client.query('DELETE FROM clips WHERE project_id = $1', [projectId]);
  await client.query('DELETE FROM captions WHERE project_id = $1', [projectId]);
  for (const row of oldRows) {
    await client.query(
      `INSERT INTO rows (id, project_id, name, kind, position, locked) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=$3, kind=$4, position=$5, locked=$6`,
      [row.id, projectId, row.name, row.kind, row.position, row.locked],
    );
  }
  for (const clip of oldClips) {
    await client.query(
      `INSERT INTO clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out,
         speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes, add_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET row_id=$3, name=$4, kind=$5, media_id=$6, start_frame=$7,
         end_frame=$8, source_in=$9, source_out=$10, speed_percent=$11, hidden=$12, group_id=$13,
         text=$14, text_colour=$15, box_colour=$16, font_weight=$17, keyframes=$18`,
      [clip.id, projectId, clip.row_id, clip.name, clip.kind, clip.media_id, Number(clip.start_frame),
        Number(clip.end_frame), Number(clip.source_in), Number(clip.source_out), Number(clip.speed_percent),
        clip.hidden, clip.group_id, clip.text, clip.text_colour, clip.box_colour, clip.font_weight,
        JSON.stringify(clip.keyframes ?? {}), Number(clip.add_order ?? 0)],
    );
  }
  for (const cap of oldCaptions) {
    await client.query(
      `INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text, original_start_ms, original_end_ms, srt_bom, srt_crlf, imported)
       VALUES ($1,$2,$3,$4,$5,$6,
         (SELECT original_start_ms FROM (SELECT NULL::int AS original_start_ms) x),
         (SELECT original_end_ms FROM (SELECT NULL::int AS original_end_ms) y),
         false, false, false)
       ON CONFLICT (id) DO UPDATE SET row_id=$3, start_frame=$4, end_frame=$5, text=$6`,
      [cap.id, projectId, cap.row_id, Number(cap.start_frame), Number(cap.end_frame), cap.text],
    );
  }
  const metaVersion = await client.query<{ version: number }>('SELECT version FROM projects WHERE id = $1', [projectId]);
  const newVersion = metaVersion.rows[0]!.version + 1;
  await client.query(
    `INSERT INTO ops (project_id, version, person_id, person_name, op_type, op, undo_data)
     VALUES ($1,$2,$3,$4,'undo:restore_cut','{}','{}')`,
    [projectId, newVersion, person.id, person.name],
  );
  await client.query('UPDATE projects SET version = $2 WHERE id = $1', [projectId, newVersion]);
  await client.query(`DELETE FROM ${stack} WHERE person_id = $1 AND project_id = $2 AND version = $3`, [person.id, projectId, version]);
  await client.query(`INSERT INTO ${other} (person_id, project_id, version) VALUES ($1,$2,$3)`, [person.id, projectId, newVersion]);
  await client.query('COMMIT');
  const timeline = await loadTimeline(ctx.db, projectId);
  return {
    version: newVersion,
    changes: { clips: timeline?.clips ?? [], captions: timeline?.captions ?? [], comments: [], rows: timeline?.rows ?? [] },
    removed: [],
    stopped: null,
    author: { id: person.id, name: person.name },
    opType: 'restore_cut',
    activity: { kind: 'restore', cut: '' },
    markersChanged: false,
  };
}

/** Undo an SRT import: the row's previous cues come back exactly. */
async function undoCaptionImport(
  client: pg.PoolClient,
  projectId: string,
  person: Person,
  version: number,
  undoData: Record<string, unknown>,
  other: string,
  stack: string,
): Promise<OpOutput> {
  const rowId = String(undoData.rowId ?? '');
  const old = undoData.old as Record<string, unknown>[];
  await client.query('DELETE FROM captions WHERE row_id = $1', [rowId]);
  for (const cap of old) {
    await client.query(
      `INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text, original_start_ms, original_end_ms, srt_bom, srt_crlf, imported)
       VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET row_id=$3, start_frame=$4, end_frame=$5, text=$6`,
      [cap.id, projectId, rowId, Number(cap.start_frame), Number(cap.end_frame), cap.text,
        cap.original_start_ms ?? null, cap.original_end_ms ?? null,
        cap.srt_bom === true, cap.srt_crlf === true, cap.imported === true],
    );
  }
  const metaVersion = await client.query<{ version: number }>('SELECT version FROM projects WHERE id = $1', [projectId]);
  const newVersion = metaVersion.rows[0]!.version + 1;
  await client.query(
    `INSERT INTO ops (project_id, version, person_id, person_name, op_type, op, undo_data)
     VALUES ($1,$2,$3,$4,'undo:caption_import','{}','{}')`,
    [projectId, newVersion, person.id, person.name],
  );
  await client.query('UPDATE projects SET version = $2 WHERE id = $1', [projectId, newVersion]);
  await client.query(`DELETE FROM ${stack} WHERE person_id = $1 AND project_id = $2 AND version = $3`, [person.id, projectId, version]);
  await client.query(`INSERT INTO ${other} (person_id, project_id, version) VALUES ($1,$2,$3)`, [person.id, projectId, newVersion]);
  await client.query('COMMIT');
  const caps = await client.query('SELECT id, row_id, start_frame, end_frame, text FROM captions WHERE row_id = $1', [rowId]);
  const captions: Caption[] = caps.rows.map((c: { id: string; row_id: string; start_frame: number; end_frame: number; text: string }) => ({
    id: c.id, row_id: c.row_id, start_frame: Number(c.start_frame), end_frame: Number(c.end_frame), text: c.text,
  }));
  return {
    version: newVersion,
    changes: { clips: [], captions, comments: [], rows: [] },
    removed: [],
    stopped: null,
    author: { id: person.id, name: person.name },
    opType: 'caption_import',
    activity: { kind: 'edit' },
    markersChanged: false,
  };
}
