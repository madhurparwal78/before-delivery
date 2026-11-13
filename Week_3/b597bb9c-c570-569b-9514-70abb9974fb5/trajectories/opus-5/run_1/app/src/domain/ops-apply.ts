/**
 * The single op path: every timeline change is applied here, in server order.
 */
import { ApiError } from './api-error.js';
import { BLOCKER } from './errors.js';
import {
  addClip,
  addMarker,
  addRow,
  addText,
  groupClips,
  lockRow,
  moveClip,
  removeClip,
  reorderRow,
  rippleRow,
  setHidden,
  setSpeed,
  splitClip,
  trimClip,
  ungroupClips,
  type ApplyOutcome,
} from './ops-clips.js';
import {
  applyKit,
  removeKeyframe,
  restoreAspect,
  restoreKeyframe,
  restoreLayer,
  restoreTextStyles,
  setAspect,
  setKeyframe,
  setLayer,
} from './ops-props.js';
import {
  captionAdd,
  captionEdit,
  captionImport,
  captionRemove,
  captionRestore,
  restoreCaptions,
} from './ops-captions.js';
import {
  clipBlocker,
  cloneState,
  findRow,
  type EngineCaption,
  type EngineClip,
  type EngineContext,
  type TimelineSnapshot,
  type TimelineState,
} from './timeline-state.js';
import { invalid, readString, readWhole } from './validate.js';
import type { RowRecord, StoppedInfo } from '../shared/types.js';

export const PUBLIC_OP_TYPES = [
  'add_clip',
  'add_text',
  'move',
  'trim',
  'split',
  'remove',
  'set_hidden',
  'set_speed',
  'group',
  'ungroup',
  'add_row',
  'reorder_row',
  'lock_row',
  'set_keyframe',
  'remove_keyframe',
  'add_marker',
  'set_layer',
  'caption_add',
  'caption_edit',
  'caption_remove',
  'apply_kit',
] as const;

export type PublicOpType = (typeof PUBLIC_OP_TYPES)[number];

export function isPublicOpType(value: unknown): value is PublicOpType {
  return typeof value === 'string' && (PUBLIC_OP_TYPES as readonly string[]).includes(value);
}

function removeClipById(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clipId = readString(op, 'clip_id');
  const clip = ctx.state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw ApiError.of('undo_missing', { clip_name: clipId });
  const stored = structuredClone(clip);
  ctx.state.clips = ctx.state.clips.filter((candidate) => candidate.id !== clipId);
  return { stopped: null, inverse: { type: 'readd_clip', clip: stored, ripple: false, shift: 0 } };
}

function readdClip(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const stored = op.clip as EngineClip;
  const ripple = op.ripple === true;
  const shift = typeof op.shift === 'number' ? op.shift : 0;
  const row = ctx.state.rows.find((candidate) => candidate.id === stored.row_id);
  if (!row) throw ApiError.of('undo_missing', { clip_name: stored.name });
  if (row.locked) throw ApiError.of('row_locked', { row_name: row.name });
  if (ripple && shift > 0) {
    rippleRow(ctx.state, stored.row_id, stored.end_frame - shift, shift, []);
  }
  const blocker = clipBlocker(ctx.state, stored.row_id, stored.start_frame, stored.end_frame, []);
  if (blocker) throw ApiError.of('undo_blocked', { clip_name: blocker.name, row_name: row.name });
  ctx.state.clips.push({ ...structuredClone(stored), added_seq: ctx.nextSeq() });
  return { stopped: null, inverse: { type: 'remove_clip', clip_id: stored.id } };
}

function moveDelta(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clipId = readString(op, 'clip_id');
  const delta = readWhole(op, 'delta');
  const rowId = typeof op.row_id === 'string' ? op.row_id : null;
  const clip = ctx.state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw ApiError.of('undo_missing', { clip_name: clipId });
  const targetRow = rowId ?? clip.row_id;
  const row = findRow(ctx.state, targetRow);
  if (row.locked) throw ApiError.of('row_locked', { row_name: row.name });
  const group = clip.group_id;
  const members = group === null ? [clip] : ctx.state.clips.filter((candidate) => candidate.group_id === group);
  const memberIds = members.map((member) => member.id);
  for (const member of members) {
    const start = member.start_frame + delta;
    const memberRow = member.id === clip.id ? targetRow : member.row_id;
    if (start < 0) throw ApiError.of('undo_blocked', { clip_name: member.name, row_name: findRow(ctx.state, memberRow).name });
    const blocker = clipBlocker(ctx.state, memberRow, start, start + (member.end_frame - member.start_frame), memberIds);
    if (blocker) throw ApiError.of('undo_blocked', { clip_name: blocker.name, row_name: findRow(ctx.state, memberRow).name });
  }
  for (const member of members) {
    member.start_frame += delta;
    member.end_frame += delta;
    if (member.id === clip.id) member.row_id = targetRow;
    for (const comment of ctx.state.comments) {
      if (comment.cut_id === null && comment.pin_clip_id === member.id) {
        comment.pin_frame += delta;
        if (member.id === clip.id) comment.pin_row_id = targetRow;
      }
    }
  }
  return { stopped: null, inverse: { type: 'move_delta', clip_id: clipId, delta: -delta, row_id: clip.row_id } };
}

function trimDelta(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clipId = readString(op, 'clip_id');
  const clip = ctx.state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw ApiError.of('undo_missing', { clip_name: clipId });
  const outcome = trimClip(ctx, {
    clip_id: clipId,
    edge: op.edge,
    delta_frames: op.delta,
    ripple: op.ripple === true,
  });
  if (outcome.stopped !== null) {
    throw ApiError.of('undo_blocked', { clip_name: clip.name, row_name: findRow(ctx.state, clip.row_id).name });
  }
  return outcome;
}

function joinClips(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const leftId = readString(op, 'left_id');
  const rightId = readString(op, 'right_id');
  const left = ctx.state.clips.find((candidate) => candidate.id === leftId);
  const right = ctx.state.clips.find((candidate) => candidate.id === rightId);
  if (!left || !right) throw ApiError.of('undo_missing', { clip_name: left ? rightId : leftId });
  if (left.end_frame !== right.start_frame) {
    throw ApiError.of('undo_blocked', { clip_name: right.name, row_name: findRow(ctx.state, right.row_id).name });
  }
  const cut = left.end_frame - left.start_frame;
  const merged = { ...left.keyframes };
  for (const [property, diamonds] of Object.entries(right.keyframes)) {
    const shifted = (diamonds ?? []).map((diamond) => ({ ...diamond, frame: diamond.frame + cut }));
    const existing = merged[property as keyof typeof merged] ?? [];
    merged[property as keyof typeof merged] = [...existing, ...shifted].sort((a, b) => a.frame - b.frame);
  }
  left.end_frame = right.end_frame;
  left.source_out = right.source_out;
  left.keyframes = merged;
  ctx.state.clips = ctx.state.clips.filter((candidate) => candidate.id !== rightId);
  return { stopped: null, inverse: { type: 'split', clip_id: leftId, at_frame: right.start_frame } };
}

function regroup(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const members = op.members as { clip_id: string; group_id: string | null }[];
  const previous: { clip_id: string; group_id: string | null }[] = [];
  for (const member of members) {
    const clip = ctx.state.clips.find((candidate) => candidate.id === member.clip_id);
    if (!clip) continue;
    previous.push({ clip_id: clip.id, group_id: clip.group_id });
    clip.group_id = member.group_id;
  }
  return { stopped: null, inverse: { type: 'regroup', members: previous } };
}

function removeRow(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const rowId = readString(op, 'row_id');
  const row = findRow(ctx.state, rowId);
  if (ctx.state.clips.some((clip) => clip.row_id === rowId) || ctx.state.captions.some((caption) => caption.row_id === rowId)) {
    throw ApiError.of('undo_blocked', { clip_name: row.name, row_name: row.name });
  }
  ctx.state.rows = ctx.state.rows.filter((candidate) => candidate.id !== rowId);
  ctx.state.rows
    .sort((a, b) => a.position - b.position)
    .forEach((candidate, index) => {
      candidate.position = index + 1;
    });
  return { stopped: null, inverse: { type: 'add_row_back', row } };
}

function addRowBack(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const row = op.row as RowRecord;
  ctx.state.rows.push({ ...row });
  return { stopped: null, inverse: { type: 'remove_row', row_id: row.id } };
}

function removeMarker(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const frame = readWhole(op, 'frame', { min: 0 });
  const label = typeof op.label === 'string' ? op.label : '';
  const at = ctx.state.markers.findIndex((marker) => marker.frame === frame && marker.label === label);
  if (at >= 0) ctx.state.markers.splice(at, 1);
  return { stopped: null, inverse: { type: 'add_marker', frame, label } };
}

interface RestorableClip {
  row_id: string;
  start_frame: number;
  end_frame: number;
  source_in: number;
  source_out: number;
  speed_percent: number;
  hidden: boolean;
  group_id: string | null;
  keyframes: EngineClip['keyframes'];
}

function restorable(clip: EngineClip): RestorableClip {
  return {
    row_id: clip.row_id,
    start_frame: clip.start_frame,
    end_frame: clip.end_frame,
    source_in: clip.source_in,
    source_out: clip.source_out,
    speed_percent: clip.speed_percent,
    hidden: clip.hidden,
    group_id: clip.group_id,
    keyframes: clip.keyframes,
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function snapshotOf(state: TimelineState): TimelineSnapshot {
  return {
    rows: structuredClone(state.rows),
    clips: structuredClone(state.clips),
    captions: structuredClone(state.captions),
  };
}

/** Restoring a cut replaces every row, clip and caption with the snapshot. */
function restoreTimeline(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const snapshot = op.snapshot as TimelineSnapshot;
  const checkLocks = op.check_locks !== false;
  const state = ctx.state;
  const previous = snapshotOf(state);
  const touchedRows = new Set<string>();

  for (const clip of snapshot.clips) {
    const current = state.clips.find((candidate) => candidate.id === clip.id);
    if (!current) {
      touchedRows.add(clip.row_id);
    } else if (!same(restorable(current), restorable(clip))) {
      touchedRows.add(current.row_id);
      touchedRows.add(clip.row_id);
    }
  }
  const keptClipIds = new Set(snapshot.clips.map((clip) => clip.id));
  for (const clip of state.clips) if (!keptClipIds.has(clip.id)) touchedRows.add(clip.row_id);

  for (const caption of snapshot.captions) {
    const current = state.captions.find((candidate) => candidate.id === caption.id);
    if (!current || current.start_frame !== caption.start_frame || current.end_frame !== caption.end_frame || current.text !== caption.text) {
      touchedRows.add(caption.row_id);
    }
  }
  const keptCaptionIds = new Set(snapshot.captions.map((caption) => caption.id));
  for (const caption of state.captions) if (!keptCaptionIds.has(caption.id)) touchedRows.add(caption.row_id);

  if (checkLocks) {
    for (const rowId of touchedRows) {
      const row = state.rows.find((candidate) => candidate.id === rowId);
      if (row?.locked) throw ApiError.of('row_locked', { row_name: row.name });
    }
  }

  for (const row of snapshot.rows) {
    const current = state.rows.find((candidate) => candidate.id === row.id);
    if (!current) {
      state.rows.push({ ...row, position: state.rows.length + 1, locked: false });
    } else {
      current.name = row.name;
      current.kind = row.kind;
    }
  }
  state.clips = snapshot.clips.map((clip) => {
    const current = state.clips.find((candidate) => candidate.id === clip.id);
    return { ...structuredClone(clip), added_seq: current?.added_seq ?? ctx.nextSeq() };
  });
  state.captions = snapshot.captions.map((caption) => ({ ...structuredClone(caption) }));
  return {
    stopped: null,
    inverse: { type: 'restore_timeline', snapshot: previous, check_locks: false },
  };
}

type Handler = (ctx: EngineContext, op: Record<string, unknown>) => ApplyOutcome;

const HANDLERS: Record<string, Handler> = {
  add_clip: addClip,
  add_text: addText,
  move: moveClip,
  trim: trimClip,
  split: splitClip,
  remove: removeClip,
  set_hidden: setHidden,
  set_speed: setSpeed,
  group: groupClips,
  ungroup: ungroupClips,
  add_row: addRow,
  reorder_row: reorderRow,
  lock_row: lockRow,
  set_keyframe: setKeyframe,
  remove_keyframe: removeKeyframe,
  add_marker: addMarker,
  set_layer: setLayer,
  caption_add: captionAdd,
  caption_edit: captionEdit,
  caption_remove: captionRemove,
  caption_import: captionImport,
  apply_kit: applyKit,
  set_aspect: setAspect,
  restore_cut: restoreTimeline,
  restore_timeline: restoreTimeline,
  restore_aspect: restoreAspect,
  restore_captions: restoreCaptions,
  caption_restore: captionRestore,
  restore_keyframe: restoreKeyframe,
  restore_layer: restoreLayer,
  restore_text_styles: restoreTextStyles,
  remove_clip: removeClipById,
  readd_clip: readdClip,
  move_delta: moveDelta,
  trim_delta: trimDelta,
  join: joinClips,
  regroup,
  remove_row: removeRow,
  add_row_back: addRowBack,
  remove_marker: removeMarker,
};

export interface AppliedOp {
  stopped: StoppedInfo | null;
  inverse: { type: string } & Record<string, unknown>;
  clips: EngineClip[];
  captions: EngineCaption[];
  rows: RowRecord[];
  commentIds: string[];
  removed: string[];
  touched: string[];
}

export function runOp(ctx: EngineContext, type: string, op: Record<string, unknown>): AppliedOp {
  const handler = HANDLERS[type];
  if (!handler) throw invalid('type');
  const before = cloneState(ctx.state);
  const outcome = handler(ctx, op);
  const after = ctx.state;

  const clips = after.clips.filter((clip) => {
    const previous = before.clips.find((candidate) => candidate.id === clip.id);
    return !previous || !same(previous, clip);
  });
  const captions = after.captions.filter((caption) => {
    const previous = before.captions.find((candidate) => candidate.id === caption.id);
    return !previous || !same(previous, caption);
  });
  const rows = after.rows.filter((row) => {
    const previous = before.rows.find((candidate) => candidate.id === row.id);
    return !previous || !same(previous, row);
  });
  const commentIds = after.comments
    .filter((comment) => {
      const previous = before.comments.find((candidate) => candidate.id === comment.id);
      return previous !== undefined && !same(previous, comment);
    })
    .map((comment) => comment.id);
  const removed = [
    ...before.clips.filter((clip) => !after.clips.some((candidate) => candidate.id === clip.id)).map((clip) => clip.id),
    ...before.captions
      .filter((caption) => !after.captions.some((candidate) => candidate.id === caption.id))
      .map((caption) => caption.id),
    ...before.rows.filter((row) => !after.rows.some((candidate) => candidate.id === row.id)).map((row) => row.id),
  ];

  const touched = new Set<string>([...removed]);
  for (const clip of clips) {
    touched.add(clip.id);
    if (clip.group_id !== null) touched.add(clip.group_id);
  }
  for (const caption of captions) touched.add(caption.id);
  for (const row of rows) touched.add(row.id);
  for (const clip of before.clips) {
    if (clips.some((changed) => changed.id === clip.id) && clip.group_id !== null) touched.add(clip.group_id);
  }
  if (before.project.aspect_ratio !== after.project.aspect_ratio) touched.add(`project:${after.project.id}`);

  return {
    stopped: outcome.stopped,
    inverse: outcome.inverse,
    clips,
    captions,
    rows,
    commentIds,
    removed,
    touched: [...touched],
  };
}


export { BLOCKER };
