/**
 * Clip ops: adding, moving, trimming, splitting, removing, ripple and groups.
 */
import { ApiError } from './api-error.js';
import { BLOCKER } from './errors.js';
import { emptyBase } from './timeline-state.js';
import {
  clipBlocker,
  clipsOnRow,
  captionsOnRow,
  clampWithReason,
  findClip,
  findRow,
  groupMembers,
  groupMoveRefusal,
  kindFitsRow,
  lengthFromSource,
  limitMoveOnRow,
  requireUnlockedRow,
  sourceDelta,
  sourceLimit,
  timelineOrder,
  type Bound,
  type EngineClip,
  type EngineContext,
  type TimelineState,
} from './timeline-state.js';
import { PNG_CLIP_SECONDS } from './media-header.js';
import { roundRational } from './rate.js';
import { invalid, readBoolean, readChoice, readString, readStringArray, readWhole } from './validate.js';
import type { Keyframe, KeyframeMap, KeyframeProperty, StoppedInfo } from '../shared/types.js';
import { projectRate } from './timeline-state.js';

export type Inverse = { type: string } & Record<string, unknown>;

export interface ApplyOutcome {
  stopped: StoppedInfo | null;
  inverse: Inverse;
}

function shiftPins(state: TimelineState, clipId: string, delta: number, rowId?: string): void {
  for (const comment of state.comments) {
    if (comment.cut_id === null && comment.pin_clip_id === clipId) {
      comment.pin_frame += delta;
      if (rowId !== undefined) comment.pin_row_id = rowId;
    }
  }
}

export function serialiseClip(clip: EngineClip): EngineClip {
  return structuredClone(clip);
}

export function addClip(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const rowId = readString(op, 'row_id');
  const mediaId = readString(op, 'media_id');
  const startFrame = readWhole(op, 'start_frame', { min: 0 });
  const row = requireUnlockedRow(state, rowId);
  const media = ctx.media.get(mediaId);
  if (!media) throw invalid('media_id');
  const kind = media.kind;
  if (!kindFitsRow(kind, row.kind)) throw invalid('row_id');
  const rate = projectRate(state);
  const sourceFrames = media.source_frames[state.project.frame_rate];
  const sourceOut = kind === 'png' ? roundRational(BigInt(PNG_CLIP_SECONDS) * rate.num, rate.den) : sourceFrames;
  const length = lengthFromSource(sourceOut, 100);
  const blocker = clipBlocker(state, rowId, startFrame, startFrame + length, []);
  if (blocker) throw ApiError.of('blocked', { clip_name: media.name, reason: BLOCKER.inTheWay(blocker.name) });
  const clip: EngineClip = {
    id: ctx.nextId('clip'),
    row_id: rowId,
    name: media.name.replace(/\.[^.]+$/, ''),
    kind,
    media_id: mediaId,
    start_frame: startFrame,
    end_frame: startFrame + length,
    source_in: 0,
    source_out: sourceOut,
    speed_percent: 100,
    hidden: false,
    group_id: null,
    text: null,
    text_colour: null,
    box_colour: null,
    font_weight: null,
    keyframes: {},
    base: emptyBase(),
    added_seq: ctx.nextSeq(),
  };
  state.clips.push(clip);
  return { stopped: null, inverse: { type: 'remove_clip', clip_id: clip.id } };
}

export function addText(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const rowId = readString(op, 'row_id');
  const startFrame = readWhole(op, 'start_frame', { min: 0 });
  const endFrame = readWhole(op, 'end_frame', { min: 1 });
  const text = readString(op, 'text', { min: 1, max: 200 });
  const row = requireUnlockedRow(state, rowId);
  if (!kindFitsRow('text', row.kind)) throw invalid('row_id');
  if (endFrame <= startFrame) throw invalid('end_frame');
  const blocker = clipBlocker(state, rowId, startFrame, endFrame, []);
  if (blocker) throw ApiError.of('blocked', { clip_name: text, reason: BLOCKER.inTheWay(blocker.name) });
  const clip: EngineClip = {
    id: ctx.nextId('clip'),
    row_id: rowId,
    name: text.split('\n')[0],
    kind: 'text',
    media_id: null,
    start_frame: startFrame,
    end_frame: endFrame,
    source_in: 0,
    source_out: endFrame - startFrame,
    speed_percent: 100,
    hidden: false,
    group_id: null,
    text,
    text_colour: 'ffffff',
    box_colour: '000000',
    font_weight: 400,
    keyframes: {},
    base: emptyBase(),
    added_seq: ctx.nextSeq(),
  };
  state.clips.push(clip);
  return { stopped: null, inverse: { type: 'remove_clip', clip_id: clip.id } };
}

export function moveClip(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const clip = findClip(state, op.clip_id);
  const startFrame = readWhole(op, 'start_frame', { min: 0 });
  const rowId = typeof op.row_id === 'string' ? op.row_id : clip.row_id;
  requireUnlockedRow(state, clip.row_id);
  const fromRow = clip.row_id;
  const fromStart = clip.start_frame;
  const length = clip.end_frame - clip.start_frame;

  if (clip.group_id !== null) {
    if (rowId !== clip.row_id) throw invalid('row_id');
    const members = groupMembers(state, clip.group_id);
    const delta = startFrame - clip.start_frame;
    const refusal = groupMoveRefusal(state, members, delta);
    if (refusal !== null) {
      const first = firstRefusedMember(state, members, delta);
      throw ApiError.of('group_blocked', { clip_name: first.clip.name, reason: first.reason });
    }
    for (const member of members) {
      member.start_frame += delta;
      member.end_frame += delta;
      shiftPins(state, member.id, delta);
    }
    return { stopped: null, inverse: { type: 'move_delta', clip_id: clip.id, delta: -delta, row_id: fromRow } };
  }

  if (rowId !== clip.row_id) {
    const target = requireUnlockedRow(state, rowId);
    if (!kindFitsRow(clip.kind, target.kind)) throw invalid('row_id');
    const blocker = clipBlocker(state, rowId, startFrame, startFrame + length, [clip.id]);
    if (blocker) throw ApiError.of('blocked', { clip_name: clip.name, reason: BLOCKER.targetRowNotFree });
    clip.row_id = rowId;
    clip.start_frame = startFrame;
    clip.end_frame = startFrame + length;
    shiftPins(state, clip.id, startFrame - fromStart, rowId);
    return {
      stopped: null,
      inverse: { type: 'move_delta', clip_id: clip.id, delta: fromStart - startFrame, row_id: fromRow },
    };
  }

  const limited = limitMoveOnRow(state, clip, startFrame);
  const delta = limited.start - clip.start_frame;
  clip.start_frame = limited.start;
  clip.end_frame = limited.start + length;
  shiftPins(state, clip.id, delta);
  return {
    stopped: limited.stopped,
    inverse: { type: 'move_delta', clip_id: clip.id, delta: -delta, row_id: fromRow },
  };
}

function firstRefusedMember(
  state: TimelineState,
  members: readonly EngineClip[],
  delta: number,
): { clip: EngineClip; reason: string } {
  const memberIds = members.map((member) => member.id);
  for (const member of timelineOrder(state).filter((clip) => memberIds.includes(clip.id))) {
    const row = findRow(state, member.row_id);
    if (row.locked) return { clip: member, reason: BLOCKER.rowLocked(row.name) };
    const start = member.start_frame + delta;
    if (start < 0) return { clip: member, reason: BLOCKER.timelineStarts };
    const blocker = clipBlocker(state, member.row_id, start, start + (member.end_frame - member.start_frame), memberIds);
    if (blocker) return { clip: member, reason: BLOCKER.inTheWay(blocker.name) };
  }
  return { clip: members[0], reason: BLOCKER.timelineStarts };
}

interface TrimPlan {
  maxima: Bound[];
  minima: Bound[];
}

function trimBounds(ctx: EngineContext, clip: EngineClip, edge: 'start' | 'end', ripple: boolean): TrimPlan {
  const state = ctx.state;
  const speed = clip.speed_percent;
  const limit = sourceLimit(ctx, clip);
  const span = clip.source_out - clip.source_in;
  const maxima: Bound[] = [];
  const minima: Bound[] = [];
  const toTimeline = (source: number): number => Math.trunc((source * 100) / speed);
  if (edge === 'end') {
    maxima.push({ limit: toTimeline(limit - clip.source_out), reason: BLOCKER.sourceEnds });
    minima.push({ limit: -toTimeline(span - 1), reason: BLOCKER.sourceStarts });
    if (!ripple) {
      const ahead = clipsOnRow(state, clip.row_id, [clip.id]).filter((other) => other.start_frame >= clip.end_frame);
      if (ahead.length > 0) maxima.push({ limit: ahead[0].start_frame - clip.end_frame, reason: BLOCKER.inTheWay(ahead[0].name) });
    }
  } else {
    maxima.push({ limit: toTimeline(span - 1), reason: BLOCKER.sourceEnds });
    minima.push({ limit: -toTimeline(clip.source_in), reason: BLOCKER.sourceStarts });
    minima.push({ limit: -clip.start_frame, reason: BLOCKER.timelineStarts });
    const behind = clipsOnRow(state, clip.row_id, [clip.id]).filter((other) => other.end_frame <= clip.start_frame);
    if (behind.length > 0) {
      const previous = behind[behind.length - 1];
      minima.push({ limit: previous.end_frame - clip.start_frame, reason: BLOCKER.inTheWay(previous.name) });
    }
  }
  return { maxima, minima };
}

function applyTrim(clip: EngineClip, edge: 'start' | 'end', delta: number): void {
  const source = sourceDelta(delta, clip.speed_percent);
  if (edge === 'end') {
    clip.source_out += source;
    clip.end_frame = clip.start_frame + lengthFromSource(clip.source_out - clip.source_in, clip.speed_percent);
  } else {
    clip.source_in += source;
    clip.start_frame = clip.end_frame - lengthFromSource(clip.source_out - clip.source_in, clip.speed_percent);
  }
}

export function trimClip(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const clip = findClip(state, op.clip_id);
  const edge = readChoice(op, 'edge', ['start', 'end'] as const);
  const deltaFrames = readWhole(op, 'delta_frames');
  const ripple = readBoolean(op, 'ripple', false);
  if (ripple && edge !== 'end') throw invalid('ripple');
  requireUnlockedRow(state, clip.row_id);
  if (deltaFrames === 0) throw invalid('delta_frames');

  if (clip.group_id !== null) {
    const members = groupMembers(state, clip.group_id);
    for (const member of members) {
      const row = findRow(state, member.row_id);
      if (row.locked) throw ApiError.of('group_blocked', { clip_name: member.name, reason: BLOCKER.rowLocked(row.name) });
      const bounds = trimBounds(ctx, member, edge, ripple);
      const clamped = clampWithReason(deltaFrames, bounds.maxima, bounds.minima);
      if (clamped.value !== deltaFrames) {
        throw ApiError.of('group_blocked', {
          clip_name: member.name,
          reason: clamped.stoppedReason ?? BLOCKER.sourceEnds,
        });
      }
    }
    const previous = members.map((member) => ({ id: member.id }));
    for (const member of members) applyTrim(member, edge, deltaFrames);
    return {
      stopped: null,
      inverse: { type: 'trim_delta', clip_id: clip.id, edge, delta: -deltaFrames, ripple, members: previous },
    };
  }

  const bounds = trimBounds(ctx, clip, edge, ripple);
  const clamped = clampWithReason(deltaFrames, bounds.maxima, bounds.minima);
  if (clamped.value === 0) {
    throw ApiError.of('blocked', { clip_name: clip.name, reason: clamped.stoppedReason ?? BLOCKER.sourceEnds });
  }
  const editPoint = clip.end_frame;
  applyTrim(clip, edge, clamped.value);
  if (ripple && clamped.value !== 0) {
    rippleRow(state, clip.row_id, editPoint, clamped.value, [clip.id]);
  }
  const stoppedFrame = edge === 'end' ? clip.end_frame : clip.start_frame;
  return {
    stopped: clamped.stoppedReason === null ? null : { at_frame: stoppedFrame, reason: clamped.stoppedReason },
    inverse: { type: 'trim_delta', clip_id: clip.id, edge, delta: -clamped.value, ripple },
  };
}

/**
 * Ripple: every clip, caption and row-pinned note on the row that starts at or
 * after the edit point shifts by exactly the frame count, and so does every
 * member of any group those clips belong to.
 */
export function rippleRow(
  state: TimelineState,
  rowId: string,
  editPoint: number,
  delta: number,
  except: readonly string[],
): void {
  const shifting = new Set<string>();
  for (const clip of clipsOnRow(state, rowId, except)) {
    if (clip.start_frame >= editPoint) shifting.add(clip.id);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const clip of state.clips) {
      if (!shifting.has(clip.id) || clip.group_id === null) continue;
      for (const member of state.clips) {
        if (member.group_id === clip.group_id && !shifting.has(member.id) && !except.includes(member.id)) {
          shifting.add(member.id);
          grew = true;
        }
      }
    }
  }
  const shiftingClips = state.clips.filter((clip) => shifting.has(clip.id));
  const shiftingCaptions = captionsOnRow(state, rowId, except).filter((caption) => caption.start_frame >= editPoint);

  const affectedRows = new Set<string>([rowId, ...shiftingClips.map((clip) => clip.row_id)]);
  for (const affected of affectedRows) {
    const row = findRow(state, affected);
    const touchesRow =
      affected === rowId
        ? shiftingClips.some((clip) => clip.row_id === affected) || shiftingCaptions.length > 0
        : shiftingClips.some((clip) => clip.row_id === affected);
    if (row.locked && touchesRow) throw ApiError.of('row_locked', { row_name: row.name });
  }

  for (const clip of shiftingClips) {
    if (clip.start_frame + delta < 0) {
      throw ApiError.of('blocked', { clip_name: clip.name, reason: BLOCKER.timelineStarts });
    }
  }
  for (const caption of shiftingCaptions) {
    if (caption.start_frame + delta < 0) {
      const row = findRow(state, rowId);
      throw ApiError.of('blocked', { clip_name: row.name, reason: BLOCKER.timelineStarts });
    }
  }
  const movingIds = [...shifting, ...except];
  for (const clip of shiftingClips) {
    const blocker = clipBlocker(
      state,
      clip.row_id,
      clip.start_frame + delta,
      clip.end_frame + delta,
      movingIds,
    );
    if (blocker) throw ApiError.of('blocked', { clip_name: clip.name, reason: BLOCKER.inTheWay(blocker.name) });
  }
  const movingCaptionIds = shiftingCaptions.map((caption) => caption.id);
  for (const caption of shiftingCaptions) {
    const blocker = captionBlockerFor(state, caption.row_id, caption.start_frame + delta, caption.end_frame + delta, [
      ...movingCaptionIds,
      ...except,
    ]);
    if (blocker) throw ApiError.of('blocked', { clip_name: `Caption`, reason: BLOCKER.inTheWay('a caption') });
  }

  for (const clip of shiftingClips) {
    clip.start_frame += delta;
    clip.end_frame += delta;
    shiftPins(state, clip.id, delta);
  }
  for (const caption of shiftingCaptions) {
    caption.start_frame += delta;
    caption.end_frame += delta;
  }
  for (const comment of state.comments) {
    if (
      comment.cut_id === null &&
      comment.pin_row_id === rowId &&
      comment.pin_clip_id === null &&
      comment.pin_frame >= editPoint
    ) {
      comment.pin_frame = Math.max(0, comment.pin_frame + delta);
    }
  }
}

function captionBlockerFor(
  state: TimelineState,
  rowId: string,
  start: number,
  end: number,
  except: readonly string[],
): boolean {
  return captionsOnRow(state, rowId, except).some(
    (caption) => start < caption.end_frame && caption.start_frame < end,
  );
}

export function splitClip(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const clip = findClip(state, op.clip_id);
  const atFrame = readWhole(op, 'at_frame', { min: 0 });
  requireUnlockedRow(state, clip.row_id);
  if (atFrame <= clip.start_frame || atFrame >= clip.end_frame) throw invalid('at_frame');
  const cut = atFrame - clip.start_frame;
  const sourceCut = clip.source_in + sourceDelta(cut, clip.speed_percent);
  const rightKeyframes: KeyframeMap = {};
  const leftKeyframes: KeyframeMap = {};
  for (const [property, diamonds] of Object.entries(clip.keyframes) as [KeyframeProperty, Keyframe[]][]) {
    const left = diamonds.filter((diamond) => diamond.frame < cut);
    const right = diamonds
      .filter((diamond) => diamond.frame >= cut)
      .map((diamond) => ({ ...diamond, frame: diamond.frame - cut }));
    if (left.length > 0) leftKeyframes[property] = left;
    if (right.length > 0) rightKeyframes[property] = right;
  }
  const right: EngineClip = {
    ...structuredClone(clip),
    id: ctx.nextId('clip'),
    start_frame: atFrame,
    end_frame: clip.end_frame,
    source_in: sourceCut,
    source_out: clip.source_out,
    keyframes: rightKeyframes,
    added_seq: ctx.nextSeq(),
  };
  clip.end_frame = atFrame;
  clip.source_out = sourceCut;
  clip.keyframes = leftKeyframes;
  state.clips.push(right);
  return { stopped: null, inverse: { type: 'join', left_id: clip.id, right_id: right.id } };
}

export function removeClip(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const clip = findClip(state, op.clip_id);
  const ripple = readBoolean(op, 'ripple', false);
  requireUnlockedRow(state, clip.row_id);
  const stored = serialiseClip(clip);
  const length = clip.end_frame - clip.start_frame;
  const editPoint = clip.end_frame;
  state.clips = state.clips.filter((candidate) => candidate.id !== clip.id);
  if (ripple) rippleRow(state, stored.row_id, editPoint, -length, [stored.id]);
  return {
    stopped: null,
    inverse: { type: 'readd_clip', clip: stored, ripple, shift: ripple ? length : 0 },
  };
}

export function setHidden(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clip = findClip(ctx.state, op.clip_id);
  const hidden = readBoolean(op, 'hidden');
  requireUnlockedRow(ctx.state, clip.row_id);
  const previous = clip.hidden;
  clip.hidden = hidden;
  return { stopped: null, inverse: { type: 'set_hidden', clip_id: clip.id, hidden: previous } };
}

export function setSpeed(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const clip = findClip(state, op.clip_id);
  const speed = readWhole(op, 'speed_percent', { min: 25, max: 400 });
  requireUnlockedRow(state, clip.row_id);
  const previous = clip.speed_percent;
  const length = lengthFromSource(clip.source_out - clip.source_in, speed);
  const blocker = clipBlocker(state, clip.row_id, clip.start_frame, clip.start_frame + length, [clip.id]);
  if (blocker) throw ApiError.of('blocked', { clip_name: clip.name, reason: BLOCKER.lengthDoesNotFit });
  clip.speed_percent = speed;
  clip.end_frame = clip.start_frame + length;
  return { stopped: null, inverse: { type: 'set_speed', clip_id: clip.id, speed_percent: previous } };
}

export function groupClips(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const ids = readStringArray(op, 'clip_ids', { min: 2 });
  const clips = ids.map((id) => findClip(state, id));
  for (const clip of clips) requireUnlockedRow(state, clip.row_id);
  const groupId = ctx.nextId('group');
  const previous = clips.map((clip) => ({ clip_id: clip.id, group_id: clip.group_id }));
  for (const clip of clips) clip.group_id = groupId;
  return { stopped: null, inverse: { type: 'regroup', members: previous } };
}

export function ungroupClips(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const groupId = readString(op, 'group_id');
  const members = state.clips.filter((clip) => clip.group_id === groupId);
  if (members.length === 0) throw invalid('group_id');
  for (const member of members) requireUnlockedRow(state, member.row_id);
  const previous = members.map((clip) => ({ clip_id: clip.id, group_id: groupId }));
  for (const member of members) member.group_id = null;
  return { stopped: null, inverse: { type: 'regroup', members: previous } };
}

export function addRow(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const name = readString(op, 'name', { min: 1, max: 60 });
  const kind = readChoice(op, 'kind', ['video', 'audio', 'caption'] as const);
  const row = {
    id: ctx.nextId('row'),
    name,
    kind,
    position: state.rows.length + 1,
    locked: false,
  };
  state.rows.push(row);
  return { stopped: null, inverse: { type: 'remove_row', row_id: row.id } };
}

export function reorderRow(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const state = ctx.state;
  const rowId = readString(op, 'row_id');
  const position = readWhole(op, 'position', { min: 1, max: state.rows.length });
  const row = findRow(state, rowId);
  const previous = row.position;
  const ordered = [...state.rows].sort((a, b) => a.position - b.position).filter((candidate) => candidate.id !== rowId);
  ordered.splice(position - 1, 0, row);
  ordered.forEach((candidate, index) => {
    candidate.position = index + 1;
  });
  return { stopped: null, inverse: { type: 'reorder_row', row_id: rowId, position: previous } };
}

export function lockRow(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const row = findRow(ctx.state, readString(op, 'row_id'));
  const locked = readBoolean(op, 'locked');
  const previous = row.locked;
  row.locked = locked;
  return { stopped: null, inverse: { type: 'lock_row', row_id: row.id, locked: previous } };
}

export function addMarker(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const frame = readWhole(op, 'frame', { min: 0 });
  const label = readString(op, 'label', { min: 0, max: 60 });
  ctx.state.markers.push({ frame, label });
  return { stopped: null, inverse: { type: 'remove_marker', frame, label } };
}

