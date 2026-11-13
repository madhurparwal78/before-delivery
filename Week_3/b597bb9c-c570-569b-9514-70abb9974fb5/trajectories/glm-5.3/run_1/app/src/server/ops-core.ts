import type { Clip, Caption, Row } from '../shared/types';
import { clipLength, trimSourceDelta, oneSecond } from '../shared/frames';
import { cueTextProblem } from './srt';
import { PROPERTY_RANGES, type LayerProperty, type Curve } from '../shared/keyframes';

/**
 * The pure op engine. Every timeline change is one op applied here in
 * server order: validation, the change, the undo record and the activity
 * event. No endpoint changes timeline state outside this module.
 */
export type StopReason =
  | { code: 'overlap'; other: string }
  | { code: 'source_start' }
  | { code: 'source_end' }
  | { code: 'row_not_free' }
  | { code: 'length_does_not_fit' }
  | { code: 'row_locked'; row: string }
  | { code: 'before_start' };

export class BlockedError extends Error {
  constructor(
    public code: 'blocked' | 'row_locked' | 'group_blocked',
    public stop: StopReason,
    public clipName: string,
    public memberName?: string,
  ) {
    super(code);
  }
}

export class OpValidation extends Error {
  constructor(public field: string) {
    super(field);
  }
}

export interface WorkingState {
  rows: Row[];
  clips: Clip[];
  captions: Caption[];
  /** Source length in frames of a clip's media, by media id. */
  sourceLength: (mediaId: string) => number;
}

export interface MediaFacts {
  kind: 'mp4' | 'wav' | 'png';
  sourceFrames: number;
  name: string;
}

export interface ApplyContext {
  media: (mediaId: string) => MediaFacts | null;
  nextId: () => string;
  frameRate: string;
}

export interface OpResult {
  touchedClips: string[];
  touchedCaptions: string[];
  touchedRows: string[];
  removed: string[];
  stopped: { at_frame: number; reason: string } | null;
  undo: Record<string, unknown>;
  activity: { kind: string; clip?: string; frame?: number; cut?: string; ratio?: string };
  newClips?: Clip[];
  markersChanged?: boolean;
}

export function newWorkingState(
  rows: Row[],
  clips: Clip[],
  captions: Caption[],
  sourceLength: (id: string) => number,
): WorkingState {
  return {
    rows: rows.map((r) => ({ ...r })),
    clips: clips.map((c) => ({ ...c, keyframes: cloneKeys(c.keyframes) })),
    captions: captions.map((c) => ({ ...c })),
    sourceLength,
  };
}

export function cloneKeys(k: Clip['keyframes']): Clip['keyframes'] {
  const out: Clip['keyframes'] = {};
  for (const [prop, list] of Object.entries(k)) {
    out[prop] = list.map((d) => ({ ...d }));
  }
  return out;
}

export function findClip(state: WorkingState, id: string): Clip {
  const clip = state.clips.find((c) => c.id === id);
  if (clip === undefined) throw new OpValidation('clip_id');
  return clip;
}

export function findRow(state: WorkingState, id: string): Row {
  const row = state.rows.find((r) => r.id === id);
  if (row === undefined) throw new OpValidation('row_id');
  return row;
}

export function findCaption(state: WorkingState, id: string): Caption {
  const cap = state.captions.find((c) => c.id === id);
  if (cap === undefined) throw new OpValidation('caption_id');
  return cap;
}

function uintField(op: Record<string, unknown>, field: string): number {
  const n = typeof op[field] === 'number' ? (op[field] as number) : Number(op[field]);
  if (!Number.isInteger(n) || n < 0) throw new OpValidation(field);
  return n;
}

function intField(op: Record<string, unknown>, field: string): number {
  const n = typeof op[field] === 'number' ? (op[field] as number) : Number(op[field]);
  if (!Number.isInteger(n)) throw new OpValidation(field);
  return n;
}

export function clipEnd(clip: Clip): number {
  return clip.start_frame + clipLength(clip.source_in, clip.source_out, clip.speed_percent);
}

function blockerOnRow(state: WorkingState, rowId: string, start: number, end: number, except: string | null): Clip | null {
  for (const c of state.clips) {
    if (c.row_id !== rowId || c.id === except) continue;
    if (start < clipEnd(c) && end > c.start_frame) return c;
  }
  return null;
}

function captionOverlap(state: WorkingState, rowId: string, start: number, end: number, except: string | null): boolean {
  for (const c of state.captions) {
    if (c.row_id !== rowId || c.id === except) continue;
    if (start < c.end_frame && end > c.start_frame) return true;
  }
  return false;
}

function groupMembers(state: WorkingState, groupId: string): Clip[] {
  return state.clips.filter((c) => c.group_id === groupId);
}

function timelineFirst(clips: Clip[]): Clip {
  return [...clips].sort((a, b) => a.start_frame - b.start_frame || (a.id < b.id ? -1 : 1))[0]!;
}

function blockedFor(members: Clip[], stop: StopReason, clip: Clip): BlockedError {
  if (members.length > 1) {
    return new BlockedError('group_blocked', stop, clip.name, timelineFirst(members).name);
  }
  return new BlockedError('blocked', stop, clip.name);
}

/** A PNG source is 3,600 seconds' worth of frames; a new PNG clip is 5 s. */
export function pngSourceFrames(rateLabel: string): number {
  return 3600 * oneSecond(rateLabel);
}

export function pngClipLength(rateLabel: string): number {
  return 5 * oneSecond(rateLabel);
}

function mkResult(kind: string): OpResult {
  return {
    touchedClips: [],
    touchedCaptions: [],
    touchedRows: [],
    removed: [],
    stopped: null,
    undo: { kind },
    activity: { kind },
  };
}

export function applyOp(state: WorkingState, op: Record<string, unknown>, ctx: ApplyContext): OpResult {
  switch (String(op.type ?? '')) {
    case 'add_clip': return opAddClip(state, op, ctx);
    case 'add_text': return opAddText(state, op, ctx);
    case 'move': return opMove(state, op);
    case 'trim': return opTrim(state, op);
    case 'split': return opSplit(state, op, ctx);
    case 'remove': return opRemove(state, op);
    case 'set_hidden': return opSetHidden(state, op);
    case 'set_speed': return opSetSpeed(state, op);
    case 'group': return opGroup(state, op);
    case 'ungroup': return opUngroup(state, op);
    case 'add_row': return opAddRow(state, op, ctx);
    case 'reorder_row': return opReorderRow(state, op);
    case 'lock_row': return opLockRow(state, op);
    case 'set_keyframe': return opSetKeyframe(state, op);
    case 'remove_keyframe': return opRemoveKeyframe(state, op);
    case 'add_marker': return opAddMarker(op);
    case 'set_layer': return opSetLayer(state, op);
    case 'caption_add': return opCaptionAdd(state, op);
    case 'caption_edit': return opCaptionEdit(state, op);
    case 'caption_remove': return opCaptionRemove(state, op);
    case 'apply_kit': return opApplyKit(state, op);
    default: throw new OpValidation('type');
  }
}

function opAddClip(state: WorkingState, op: Record<string, unknown>, ctx: ApplyContext): OpResult {
  const row = findRow(state, String(op.row_id ?? ''));
  const media = ctx.media(String(op.media_id ?? ''));
  if (media === null) throw new OpValidation('media_id');
  if (row.locked) throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, row.name);
  if (media.kind === 'wav' ? row.kind !== 'audio' : row.kind !== 'video') throw new OpValidation('row_id');
  const start = uintField(op, 'start_frame');
  const clipLen = media.kind === 'png' ? pngClipLength(ctx.frameRate) : media.sourceFrames;
  const sourceLen = media.kind === 'png' ? pngSourceFrames(ctx.frameRate) : media.sourceFrames;
  const blocker = blockerOnRow(state, row.id, start, start + clipLen, null);
  if (blocker !== null) throw new BlockedError('blocked', { code: 'overlap', other: blocker.name }, blocker.name);
  const id = ctx.nextId();
  const clip: Clip = {
    id, row_id: row.id, name: media.name, kind: media.kind, media_id: String(op.media_id ?? ''),
    start_frame: start, end_frame: start + clipLen, source_in: 0, source_out: clipLen,
    speed_percent: 100, hidden: false, group_id: null,
    text: null, text_colour: null, box_colour: null, font_weight: null, keyframes: {},
  };
  if (clipLen > sourceLen) clip.source_out = sourceLen;
  state.clips.push(clip);
  const r = mkResult('edit');
  r.touchedClips = [id];
  r.newClips = [clip];
  r.undo = { kind: 'add', clipId: id };
  return r;
}

function opAddText(state: WorkingState, op: Record<string, unknown>, ctx: ApplyContext): OpResult {
  const row = findRow(state, String(op.row_id ?? ''));
  if (row.kind !== 'video') throw new OpValidation('row_id');
  if (row.locked) throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, row.name);
  const start = uintField(op, 'start_frame');
  const end = uintField(op, 'end_frame');
  if (end <= start) throw new OpValidation('end_frame');
  const text = String(op.text ?? '');
  if (text.trim() === '') throw new OpValidation('text');
  const blocker = blockerOnRow(state, row.id, start, end, null);
  if (blocker !== null) throw new BlockedError('blocked', { code: 'overlap', other: blocker.name }, blocker.name);
  const id = ctx.nextId();
  const clip: Clip = {
    id, row_id: row.id, name: text.slice(0, 40), kind: 'text', media_id: null,
    start_frame: start, end_frame: end, source_in: 0, source_out: end - start,
    speed_percent: 100, hidden: false, group_id: null,
    text, text_colour: null, box_colour: null, font_weight: null, keyframes: {},
  };
  state.clips.push(clip);
  const r = mkResult('edit');
  r.touchedClips = [id];
  r.newClips = [clip];
  r.undo = { kind: 'add', clipId: id };
  return r;
}

function opMove(state: WorkingState, op: Record<string, unknown>): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const targetRowId = op.row_id === undefined ? clip.row_id : String(op.row_id);
  const targetRow = findRow(state, targetRowId);
  const start = uintField(op, 'start_frame');
  const members = clip.group_id !== null ? groupMembers(state, clip.group_id) : [clip];
  const movingIds = new Set(members.map((m) => m.id));
  const originals = members.map((m) => ({ id: m.id, start_frame: m.start_frame, row_id: m.row_id }));
  const delta = start - clip.start_frame;

  if (members.length > 1 && targetRowId !== clip.row_id) throw new OpValidation('row_id');

  for (const m of members) {
    const row = findRow(state, m.row_id);
    if (row.locked) {
      if (members.length > 1) throw blockedFor(members, { code: 'row_locked', row: row.name }, clip);
      throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, row.name);
    }
    if (m.start_frame + delta < 0) throw blockedFor(members, { code: 'before_start' }, clip);
  }
  // A move that cannot go one frame is refused: a zero delta answers blocked.
  if (delta === 0 && targetRowId === clip.row_id) {
    throw new BlockedError('blocked', { code: 'overlap', other: clip.name }, clip.name);
  }
  if (members.length === 1 && targetRowId !== clip.row_id) {
    if (targetRow.locked) {
      throw new BlockedError('row_locked', { code: 'row_locked', row: targetRow.name }, clip.name);
    }
    const end = start + (clip.end_frame - clip.start_frame);
    const blocker = blockerOnRow(state, targetRowId, start, end, clip.id);
    if (blocker !== null) throw new BlockedError('blocked', { code: 'row_not_free' }, clip.name);
    const original = { id: clip.id, start_frame: clip.start_frame, row_id: clip.row_id };
    clip.start_frame = start;
    clip.end_frame = end;
    clip.row_id = targetRowId;
    const r = mkResult('move');
    r.touchedClips = [clip.id];
    r.activity = { kind: 'move', clip: clip.name, frame: start };
    r.undo = { kind: 'move', moves: [original], clipId: clip.id };
    return r;
  }

  // Same-row move (single or grouped): slide as far as it can, stop on the
  // nearest free frame. Groups never stop partway.
  let stopped: { at_frame: number; reason: string } | null = null;
  for (const m of members) {
    const length = m.end_frame - m.start_frame;
    const row = findRow(state, m.row_id);
    void row;
    let target = m.start_frame + delta;
    let blockName = '';
    for (const other of state.clips) {
      if (other.row_id !== m.row_id || other.id === m.id || movingIds.has(other.id)) continue;
      if (target < clipEnd(other) && target + length > other.start_frame) {
        if (members.length > 1) throw blockedFor(members, { code: 'overlap', other: other.name }, clip);
        blockName = other.name;
        if (delta > 0) target = Math.min(target, other.start_frame - length);
        else target = Math.max(target, clipEnd(other));
      }
    }
    if (target < 0) {
      if (members.length > 1) throw blockedFor(members, { code: 'before_start' }, clip);
      target = 0;
    }
    if (target !== m.start_frame + delta && blockName !== '') {
      stopped = { at_frame: target, reason: `${blockName} is in the way` };
    }
    m.start_frame = target;
    m.end_frame = target + length;
  }
  if (members.length === 1 && clip.start_frame === originals[0]!.start_frame) {
    // The move could not go a single frame: refused with the blocker named.
    throw new BlockedError('blocked', { code: 'overlap', other: stopped?.reason?.replace(' is in the way', '') ?? clip.name }, clip.name);
  }
  const r = mkResult('move');
  r.touchedClips = members.map((m) => m.id);
  r.stopped = stopped;
  r.activity = { kind: 'move', clip: clip.name, frame: clip.start_frame };
  r.undo = { kind: 'move', moves: originals, clipId: clip.id };
  return r;
}

function opTrim(state: WorkingState, op: Record<string, unknown>): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const edge = String(op.edge ?? '');
  if (edge !== 'start' && edge !== 'end') throw new OpValidation('edge');
  const ripple = op.ripple === true;
  const delta = intField(op, 'delta_frames');
  if (ripple && edge !== 'end') throw new OpValidation('ripple');

  const members = clip.group_id !== null ? groupMembers(state, clip.group_id) : [clip];
  for (const m of members) {
    const row = findRow(state, m.row_id);
    if (row.locked) throw blockedFor(members, { code: 'row_locked', row: row.name }, clip);
  }
  const originals = members.map((m) => ({ ...m, keyframes: cloneKeys(m.keyframes) }));

  if (ripple) {
    if (members.length > 1) throw new OpValidation('ripple');
    return rippleTrim(state, clip, delta, originals[0]!);
  }

  let stopped: { at_frame: number; reason: string } | null = null;
  for (const m of members) {
    const sourceDelta = trimSourceDelta(delta, m.speed_percent);
    if (edge === 'start') {
      let sourceIn = m.source_in + sourceDelta;
      if (sourceIn < 0) {
        if (members.length > 1) throw blockedFor(members, { code: 'source_start' }, clip);
        sourceIn = 0;
        stopped = { at_frame: m.start_frame, reason: 'the source starts there' };
      }
      const limit = sourceLimit(state, m);
      if (sourceIn > limit) {
        if (members.length > 1) throw blockedFor(members, { code: 'source_end' }, clip);
        sourceIn = limit;
        stopped = { at_frame: m.start_frame, reason: 'the source ends there' };
      }
      const newLength = clipLength(sourceIn, m.source_out, m.speed_percent);
      let newStart = m.end_frame - newLength;
      if (newStart < 0) {
        if (members.length > 1) throw blockedFor(members, { code: 'before_start' }, clip);
        newStart = 0;
        sourceIn = m.source_in;
        stopped = { at_frame: 0, reason: 'the timeline starts there' };
      }
      // Growing leftwards must not hit the clip before on the row.
      const blocker = blockerOnRow(state, m.row_id, newStart, m.end_frame, m.id);
      if (blocker !== null) {
        if (members.length > 1) throw blockedFor(members, { code: 'overlap', other: blocker.name }, clip);
        const roomStart = blocker.end_frame;
        if (roomStart >= m.end_frame) {
          throw new BlockedError('blocked', { code: 'overlap', other: blocker.name }, m.name);
        }
        let candidate = sourceIn;
        while (m.end_frame - clipLength(candidate, m.source_out, m.speed_percent) < roomStart && candidate > 0) {
          candidate--;
        }
        if (m.end_frame - clipLength(candidate, m.source_out, m.speed_percent) < roomStart) {
          throw new BlockedError('blocked', { code: 'overlap', other: blocker.name }, m.name);
        }
        sourceIn = candidate;
        newStart = m.end_frame - clipLength(sourceIn, m.source_out, m.speed_percent);
        stopped = { at_frame: newStart, reason: `${blocker.name} is in the way` };
      }
      m.source_in = sourceIn;
      m.start_frame = newStart;
    } else {
      let sourceOut = m.source_out + sourceDelta;
      const limit = sourceLimit(state, m);
      if (sourceOut < m.source_in) {
        if (members.length > 1) throw blockedFor(members, { code: 'source_start' }, clip);
        sourceOut = m.source_in;
        stopped = { at_frame: m.end_frame, reason: 'the source starts there' };
      }
      if (sourceOut > limit) {
        if (members.length > 1) throw blockedFor(members, { code: 'source_end' }, clip);
        sourceOut = limit;
        stopped = { at_frame: m.end_frame, reason: 'the source ends there' };
      }
      let newEnd = m.start_frame + clipLength(m.source_in, sourceOut, m.speed_percent);
      const blocker = blockerOnRow(state, m.row_id, m.start_frame, newEnd, m.id);
      if (blocker !== null) {
        if (members.length > 1) throw blockedFor(members, { code: 'overlap', other: blocker.name }, clip);
        const roomEnd = blocker.start_frame;
        let candidate = sourceOut;
        while (m.start_frame + clipLength(m.source_in, candidate, m.speed_percent) > roomEnd && candidate > m.source_in) {
          candidate--;
        }
        if (m.start_frame + clipLength(m.source_in, candidate, m.speed_percent) > roomEnd) {
          throw new BlockedError('blocked', { code: 'overlap', other: blocker.name }, m.name);
        }
        sourceOut = candidate;
        newEnd = m.start_frame + clipLength(m.source_in, sourceOut, m.speed_percent);
        stopped = { at_frame: newEnd, reason: `${blocker.name} is in the way` };
      }
      m.source_out = sourceOut;
      m.end_frame = newEnd;
    }
  }
  const first = members[0]!;
  const orig = originals[0]!;
  if (members.length === 1 && !clipChanged(orig, first)) {
    throw new BlockedError('blocked', stopOf(stopped, first.name), first.name);
  }
  const r = mkResult('trim');
  r.touchedClips = members.map((m) => m.id);
  r.stopped = stopped;
  r.activity = { kind: 'trim', clip: clip.name };
  r.undo = { kind: 'trim', members: originals };
  return r;
}

function stopOf(stopped: { reason: string } | null, name: string): StopReason {
  if (stopped === null) return { code: 'overlap', other: name };
  if (stopped.reason === 'the source starts there') return { code: 'source_start' };
  if (stopped.reason === 'the source ends there') return { code: 'source_end' };
  if (stopped.reason === 'the timeline starts there') return { code: 'before_start' };
  return { code: 'overlap', other: stopped.reason.replace(' is in the way', '') };
}

function clipChanged(a: Clip, b: Clip): boolean {
  return a.start_frame !== b.start_frame || a.end_frame !== b.end_frame || a.source_in !== b.source_in || a.source_out !== b.source_out;
}

/** A clip's own source end in source frames. */
function sourceLimit(state: WorkingState, clip: Clip): number {
  if (clip.kind === 'text') return Number.MAX_SAFE_INTEGER;
  if (clip.media_id === null) return Number.MAX_SAFE_INTEGER;
  return state.sourceLength(clip.media_id);
}

/** Ripple trim of the end edge: shift every later item on the row by the delta. */
function rippleTrim(state: WorkingState, clip: Clip, delta: number, original: Clip): OpResult {
  const sourceDelta = trimSourceDelta(delta, clip.speed_percent);
  const newSourceOut = clip.source_out + sourceDelta;
  if (newSourceOut > sourceLimit(state, clip)) {
    throw new BlockedError('blocked', { code: 'source_end' }, clip.name);
  }
  if (newSourceOut < clip.source_in) {
    throw new BlockedError('blocked', { code: 'source_start' }, clip.name);
  }
  const newEnd = clip.start_frame + clipLength(clip.source_in, newSourceOut, clip.speed_percent);
  const shift = newEnd - clip.end_frame;
  const editPoint = clip.end_frame;

  const shiftingClips = state.clips.filter((c) => c.row_id === clip.row_id && c.id !== clip.id && c.start_frame >= editPoint);
  const shiftingCaptions = state.captions.filter((c) => c.row_id === clip.row_id && c.start_frame >= editPoint);
  if (shift < 0) {
    for (const item of [...shiftingClips, ...shiftingCaptions]) {
      if (item.start_frame + shift < 0) {
        throw new BlockedError('blocked', { code: 'before_start' }, clip.name);
      }
    }
  }
  for (const item of shiftingClips) {
    for (const other of state.clips) {
      if (other.row_id !== clip.row_id || other.id === item.id || other.id === clip.id) continue;
      if (shiftingClips.includes(other)) continue;
      const ns = item.start_frame + shift;
      const ne = ns + (item.end_frame - item.start_frame);
      if (ns < clipEnd(other) && ne > other.start_frame) {
        throw new BlockedError('blocked', { code: 'overlap', other: other.name }, clip.name);
      }
    }
  }
  for (const item of shiftingCaptions) {
    for (const other of state.captions) {
      if (other.row_id !== clip.row_id || other.id === item.id) continue;
      if (shiftingCaptions.includes(other)) continue;
      const ns = item.start_frame + shift;
      const ne = ns + (item.end_frame - item.start_frame);
      if (ns < other.end_frame && ne > other.start_frame) {
        throw new BlockedError('blocked', { code: 'overlap', other: 'caption' }, clip.name);
      }
    }
  }
  const oldSourceOut = clip.source_out;
  clip.source_out = newSourceOut;
  clip.end_frame = newEnd;
  const shiftedClipIds = shiftingClips.map((c) => c.id);
  const shiftedCaptionIds = shiftingCaptions.map((c) => c.id);
  for (const c of shiftingClips) { c.start_frame += shift; c.end_frame += shift; }
  for (const c of shiftingCaptions) { c.start_frame += shift; c.end_frame += shift; }
  const r = mkResult('trim');
  r.touchedClips = [clip.id, ...shiftedClipIds];
  r.touchedCaptions = shiftedCaptionIds;
  r.activity = { kind: 'trim', clip: clip.name };
  r.undo = {
    kind: 'ripple_trim',
    clip: { id: clip.id, source_out: oldSourceOut, start_frame: original.start_frame, end_frame: original.end_frame },
    shift,
    shiftedClips: shiftedClipIds.map((id) => {
      const c = state.clips.find((x) => x.id === id)!;
      return { id, start_frame: c.start_frame - shift, end_frame: c.end_frame - shift };
    }),
    shiftedCaptions: shiftedCaptionIds.map((id) => {
      const c = state.captions.find((x) => x.id === id)!;
      return { id, start_frame: c.start_frame - shift, end_frame: c.end_frame - shift };
    }),
  };
  return r;
}

function opSplit(state: WorkingState, op: Record<string, unknown>, ctx: ApplyContext): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const at = uintField(op, 'at_frame');
  if (at <= clip.start_frame || at >= clip.end_frame) throw new OpValidation('at_frame');
  const row = findRow(state, clip.row_id);
  if (row.locked) throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, clip.name);
  const leftLength = at - clip.start_frame;
  const leftSourceOut = clip.source_in + trimSourceDelta(leftLength, clip.speed_percent);
  const id = ctx.nextId();
  const right: Clip = {
    ...clip,
    id,
    start_frame: at,
    end_frame: clip.end_frame,
    source_in: leftSourceOut,
    source_out: clip.source_out,
    keyframes: {},
  };
  right.keyframes = cloneKeys(clip.keyframes);
  for (const [prop, list] of Object.entries(right.keyframes)) {
    right.keyframes[prop] = list
      .filter((d) => d.frame >= leftLength)
      .map((d) => ({ ...d, frame: d.frame - leftLength }));
  }
  const originalEnd = clip.end_frame;
  clip.source_out = leftSourceOut;
  clip.end_frame = at;
  state.clips.push(right);
  const r = mkResult('split');
  r.touchedClips = [clip.id, id];
  r.newClips = [right];
  r.activity = { kind: 'split', clip: clip.name, frame: at };
  r.undo = { kind: 'split', leftId: clip.id, rightId: id, leftEnd: originalEnd };
  return r;
}

function opRemove(state: WorkingState, op: Record<string, unknown>): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const ripple = op.ripple === true;
  const row = findRow(state, clip.row_id);
  if (row.locked) throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, clip.name);
  const original = { ...clip, keyframes: cloneKeys(clip.keyframes) };
  const removedFrames = clip.end_frame - clip.start_frame;
  const editPoint = clip.start_frame;

  state.clips = state.clips.filter((c) => c.id !== clip.id);
  const r = mkResult('remove');
  r.removed = [clip.id];
  r.touchedClips = [clip.id];
  r.activity = { kind: 'remove', clip: clip.name };
  r.undo = { kind: 'remove', clip: original };

  if (ripple) {
    const shiftingClips = state.clips.filter((c) => c.row_id === row.id && c.start_frame >= editPoint);
    const shiftingCaptions = state.captions.filter((c) => c.row_id === row.id && c.start_frame >= editPoint);
    for (const item of [...shiftingClips, ...shiftingCaptions]) {
      if (item.start_frame - removedFrames < 0) {
        throw new BlockedError('blocked', { code: 'before_start' }, clip.name);
      }
    }
    for (const item of shiftingClips) {
      for (const other of state.clips) {
        if (other.row_id !== row.id || other.id === item.id || shiftingClips.includes(other)) continue;
        const ns = item.start_frame - removedFrames;
        const ne = ns + (item.end_frame - item.start_frame);
        if (ns < clipEnd(other) && ne > other.start_frame) {
          throw new BlockedError('blocked', { code: 'overlap', other: other.name }, clip.name);
        }
      }
    }
    for (const item of shiftingCaptions) {
      for (const other of state.captions) {
        if (other.row_id !== row.id || other.id === item.id || shiftingCaptions.includes(other)) continue;
        const ns = item.start_frame - removedFrames;
        const ne = ns + (item.end_frame - item.start_frame);
        if (ns < other.end_frame && ne > other.start_frame) {
          throw new BlockedError('blocked', { code: 'overlap', other: 'caption' }, clip.name);
        }
      }
    }
    for (const c of shiftingClips) { c.start_frame -= removedFrames; c.end_frame -= removedFrames; }
    for (const c of shiftingCaptions) { c.start_frame -= removedFrames; c.end_frame -= removedFrames; }
    r.touchedClips = [clip.id, ...shiftingClips.map((c) => c.id)];
    r.touchedCaptions = shiftingCaptions.map((c) => c.id);
    r.undo = {
      kind: 'ripple_remove',
      clip: original,
      removedFrames,
      shiftedClips: shiftingClips.map((c) => ({ id: c.id, start_frame: c.start_frame + removedFrames, end_frame: c.end_frame + removedFrames })),
      shiftedCaptions: shiftingCaptions.map((c) => ({ id: c.id, start_frame: c.start_frame + removedFrames, end_frame: c.end_frame + removedFrames })),
    };
  }
  return r;
}

function opSetHidden(state: WorkingState, op: Record<string, unknown>): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const hidden = op.hidden === true;
  clip.hidden = hidden;
  const r = mkResult(hidden ? 'hide' : 'show');
  r.touchedClips = [clip.id];
  r.activity = { kind: hidden ? 'hide' : 'show', clip: clip.name };
  r.undo = { kind: 'hidden', clipId: clip.id, was: !hidden };
  return r;
}

function opSetSpeed(state: WorkingState, op: Record<string, unknown>): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const speed = intField(op, 'speed_percent');
  if (speed < 25 || speed > 400) throw new OpValidation('speed_percent');
  const newEnd = clip.start_frame + clipLength(clip.source_in, clip.source_out, speed);
  const blocker = blockerOnRow(state, clip.row_id, clip.start_frame, newEnd, clip.id);
  if (blocker !== null) throw new BlockedError('blocked', { code: 'length_does_not_fit' }, clip.name);
  const original = { speed: clip.speed_percent, end: clip.end_frame };
  clip.speed_percent = speed;
  clip.end_frame = newEnd;
  const r = mkResult('edit');
  r.touchedClips = [clip.id];
  r.activity = { kind: 'edit', clip: clip.name };
  r.undo = { kind: 'speed', clipId: clip.id, ...original };
  return r;
}

function opGroup(state: WorkingState, op: Record<string, unknown>): OpResult {
  const ids = Array.isArray(op.clip_ids) ? (op.clip_ids as unknown[]).map(String) : [];
  if (ids.length < 2) throw new OpValidation('clip_ids');
  const clips = ids.map((id) => findClip(state, id));
  for (const c of clips) {
    if (c.group_id !== null) throw new OpValidation('clip_ids');
  }
  const groupId = `grp-${clips.map((c) => c.id).sort().join('-').slice(0, 40)}`;
  for (const c of clips) c.group_id = groupId;
  const r = mkResult('edit');
  r.touchedClips = clips.map((c) => c.id);
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'group', clipIds: clips.map((c) => c.id) };
  return r;
}

function opUngroup(state: WorkingState, op: Record<string, unknown>): OpResult {
  const groupId = String(op.group_id ?? '');
  const members = groupMembers(state, groupId);
  if (members.length === 0) throw new OpValidation('group_id');
  for (const m of members) m.group_id = null;
  const r = mkResult('edit');
  r.touchedClips = members.map((m) => m.id);
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'ungroup', clipIds: members.map((m) => m.id), groupId };
  return r;
}

function opAddRow(state: WorkingState, op: Record<string, unknown>, ctx: ApplyContext): OpResult {
  const name = String(op.name ?? '').trim();
  if (name === '') throw new OpValidation('name');
  const kind = String(op.kind ?? '');
  if (kind !== 'video' && kind !== 'audio' && kind !== 'caption') throw new OpValidation('kind');
  const id = ctx.nextId();
  state.rows.push({ id, name, kind, position: state.rows.length + 1, locked: false });
  const r = mkResult('edit');
  r.touchedRows = [id];
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'add_row', rowId: id };
  return r;
}

function opReorderRow(state: WorkingState, op: Record<string, unknown>): OpResult {
  const row = findRow(state, String(op.row_id ?? ''));
  const position = intField(op, 'position');
  if (position < 1 || position > state.rows.length) throw new OpValidation('position');
  const oldPosition = row.position;
  const sorted = [...state.rows].sort((a, b) => a.position - b.position);
  const without = sorted.filter((r) => r.id !== row.id);
  without.splice(position - 1, 0, row);
  without.forEach((rw, i) => {
    rw.position = i + 1;
  });
  const r = mkResult('edit');
  r.touchedRows = without.map((rw) => rw.id);
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'reorder_row', rowId: row.id, position: oldPosition };
  return r;
}

function opLockRow(state: WorkingState, op: Record<string, unknown>): OpResult {
  const row = findRow(state, String(op.row_id ?? ''));
  const locked = op.locked === true;
  row.locked = locked;
  const r = mkResult('edit');
  r.touchedRows = [row.id];
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'lock_row', rowId: row.id, was: !locked };
  return r;
}

function opSetKeyframe(state: WorkingState, op: Record<string, unknown>): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const property = String(op.property ?? '');
  if (!isLayerProperty(property)) throw new OpValidation('property');
  const frame = intField(op, 'frame');
  const value = op.value;
  if (typeof value !== 'number') throw new OpValidation('value');
  const curveRaw = String(op.curve ?? 'linear');
  const curve: Curve = curveRaw === 'eased' ? 'eased' : 'linear';
  const range = PROPERTY_RANGES[property];
  if (value < range.min || value > range.max) throw new OpValidation('value');
  const clipLengthFrames = clip.end_frame - clip.start_frame;
  if (frame < 0 || frame >= clipLengthFrames) throw new OpValidation('frame');
  const list = clip.keyframes[property] ?? [];
  const existing = list.find((d) => d.frame === frame);
  const previous = existing === undefined ? null : { ...existing };
  if (existing !== undefined) {
    existing.value = value;
  } else {
    list.push({ frame, value, curve });
    list.sort((a, b) => a.frame - b.frame);
  }
  clip.keyframes[property] = list;
  const r = mkResult('edit');
  r.touchedClips = [clip.id];
  r.activity = { kind: 'edit', clip: clip.name };
  r.undo = { kind: 'keyframe', clipId: clip.id, property, frame, previous };
  return r;
}

function opRemoveKeyframe(state: WorkingState, op: Record<string, unknown>): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const property = String(op.property ?? '');
  if (!isLayerProperty(property)) throw new OpValidation('property');
  const frame = intField(op, 'frame');
  const list = clip.keyframes[property] ?? [];
  const existing = list.find((d) => d.frame === frame);
  if (existing === undefined) throw new OpValidation('frame');
  clip.keyframes[property] = list.filter((d) => d.frame !== frame);
  const r = mkResult('edit');
  r.touchedClips = [clip.id];
  r.activity = { kind: 'edit', clip: clip.name };
  r.undo = { kind: 'remove_keyframe', clipId: clip.id, property, previous: { ...existing } };
  return r;
}

function opAddMarker(op: Record<string, unknown>): OpResult {
  const frame = uintField(op, 'frame');
  const label = String(op.label ?? '');
  const r = mkResult('edit');
  r.markersChanged = true;
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'marker', frame, label };
  return r;
}

function opSetLayer(state: WorkingState, op: Record<string, unknown>): OpResult {
  const clip = findClip(state, String(op.clip_id ?? ''));
  const row = findRow(state, clip.row_id);
  if (row.locked) throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, clip.name);
  const frame = intField(op, 'frame');
  if (frame < 0 || frame >= clip.end_frame - clip.start_frame) throw new OpValidation('frame');
  const props: Record<string, number> = {};
  for (const p of ['x', 'y', 'scale'] as const) {
    if (op[p] !== undefined) {
      const v = op[p];
      if (typeof v !== 'number') throw new OpValidation(p);
      const range = PROPERTY_RANGES[p];
      if (v < range.min || v > range.max) throw new OpValidation(p);
      props[p] = v;
    }
  }
  if (Object.keys(props).length === 0) throw new OpValidation('x');
  const undoProps: Record<string, unknown> = {};
  for (const [p, v] of Object.entries(props)) {
    const list = clip.keyframes[p] ?? [];
    const existing = list.find((d) => d.frame === frame);
    if (list.length === 0) {
      undoProps[p] = { mode: 'base' };
      clip.keyframes[p] = [{ frame: 0, value: v, curve: 'linear' }];
    } else if (existing !== undefined) {
      undoProps[p] = { mode: 'diamond', previous: { ...existing } };
      existing.value = v;
    } else {
      undoProps[p] = { mode: 'removed' };
      list.push({ frame, value: v, curve: 'linear' });
      list.sort((a, b) => a.frame - b.frame);
    }
    clip.keyframes[p] = list;
  }
  const r = mkResult('shape');
  r.touchedClips = [clip.id];
  r.activity = { kind: 'shape', clip: clip.name };
  r.undo = { kind: 'set_layer', clipId: clip.id, frame, props: undoProps };
  return r;
}

function opCaptionAdd(state: WorkingState, op: Record<string, unknown>): OpResult {
  const row = findRow(state, String(op.row_id ?? ''));
  if (row.kind !== 'caption') throw new OpValidation('row_id');
  if (row.locked) throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, row.name);
  const start = uintField(op, 'start_frame');
  const end = uintField(op, 'end_frame');
  if (end <= start) throw new OpValidation('end_frame');
  const text = String(op.text ?? '');
  const problem = cueTextProblem(text);
  if (problem !== null) throw new OpValidation('text');
  if (captionOverlap(state, row.id, start, end, null)) throw new OpValidation('start_frame');
  const id = `${row.id}-cap-${start}-${end}`;
  state.captions.push({ id, row_id: row.id, start_frame: start, end_frame: end, text });
  const r = mkResult('edit');
  r.touchedCaptions = [id];
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'caption_add', captionId: id };
  return r;
}

function opCaptionEdit(state: WorkingState, op: Record<string, unknown>): OpResult {
  const caption = findCaption(state, String(op.caption_id ?? ''));
  const row = findRow(state, caption.row_id);
  if (row.locked) throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, row.name);
  const start = uintField(op, 'start_frame');
  const end = uintField(op, 'end_frame');
  if (end <= start) throw new OpValidation('end_frame');
  const text = String(op.text ?? '');
  const problem = cueTextProblem(text);
  if (problem !== null) throw new OpValidation('text');
  if (captionOverlap(state, caption.row_id, start, end, caption.id)) throw new OpValidation('start_frame');
  const original = { ...caption };
  caption.start_frame = start;
  caption.end_frame = end;
  caption.text = text;
  const r = mkResult('edit');
  r.touchedCaptions = [caption.id];
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'caption_edit', caption: original };
  return r;
}

function opCaptionRemove(state: WorkingState, op: Record<string, unknown>): OpResult {
  const caption = findCaption(state, String(op.caption_id ?? ''));
  const row = findRow(state, caption.row_id);
  if (row.locked) throw new BlockedError('row_locked', { code: 'row_locked', row: row.name }, row.name);
  state.captions = state.captions.filter((c) => c.id !== caption.id);
  const r = mkResult('edit');
  r.touchedCaptions = [caption.id];
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'caption_remove', caption: { ...caption } };
  return r;
}

function opApplyKit(state: WorkingState, op: Record<string, unknown>): OpResult {
  const textColour = String(op.text_colour ?? '');
  const boxColour = String(op.box_colour ?? '');
  const weight = intField(op, 'font_weight');
  if (weight !== 400 && weight !== 600) throw new OpValidation('font_weight');
  const touched: string[] = [];
  const undoTexts: Record<string, unknown> = {};
  for (const c of state.clips) {
    if (c.kind !== 'text') continue;
    undoTexts[c.id] = { text_colour: c.text_colour, box_colour: c.box_colour, font_weight: c.font_weight };
    c.text_colour = textColour;
    c.box_colour = boxColour;
    c.font_weight = weight;
    touched.push(c.id);
  }
  const r = mkResult('edit');
  r.touchedClips = touched;
  r.activity = { kind: 'edit' };
  r.undo = { kind: 'apply_kit', texts: undoTexts };
  return r;
}

export function isLayerProperty(p: string): p is LayerProperty {
  return p === 'x' || p === 'y' || p === 'scale' || p === 'rotation' || p === 'opacity';
}
