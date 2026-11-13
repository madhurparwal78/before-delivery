/**
 * The timeline state the op engine works on, and the geometry rules that decide
 * overlap, stops, ripple and group reach.
 */
import { ApiError } from './api-error.js';
import { BLOCKER } from './errors.js';
import type { LayerBase, LayerClip } from './layers.js';
import { exactRate, roundRational, type ExactRate } from './rate.js';
import type {
  AspectRatio,
  CaptionRecord,
  ClipKind,
  ClipRecord,
  KitRecord,
  Marker,
  MediaKind,
  RowKind,
  RowRecord,
  StoppedInfo,
} from '../shared/types.js';
import type { FrameRateName } from './rate.js';

export interface EngineClip extends ClipRecord {
  base: LayerBase;
  added_seq: number;
}

export interface EngineCaption extends CaptionRecord {
  import_start_ms: number | null;
  import_end_ms: number | null;
  import_start_frame: number | null;
  import_end_frame: number | null;
}

export interface EngineComment {
  id: string;
  cut_id: string | null;
  pin_frame: number;
  pin_row_id: string | null;
  pin_clip_id: string | null;
}

export interface MediaInfo {
  id: string;
  name: string;
  kind: MediaKind;
  sha256: string;
  width: number | null;
  height: number | null;
  source_frames: Record<FrameRateName, number>;
}

export interface TimelineProject {
  id: string;
  title: string;
  frame_rate: FrameRateName;
  aspect_ratio: AspectRatio;
  version: number;
}

export interface TimelineState {
  project: TimelineProject;
  rows: RowRecord[];
  clips: EngineClip[];
  captions: EngineCaption[];
  markers: Marker[];
  comments: EngineComment[];
}

export interface EngineContext {
  state: TimelineState;
  media: Map<string, MediaInfo>;
  kits: Map<string, KitRecord>;
  snapshots: Map<string, TimelineSnapshot>;
  nextId: (prefix: string) => string;
  nextSeq: () => number;
}

export interface TimelineSnapshot {
  rows: RowRecord[];
  clips: EngineClip[];
  captions: EngineCaption[];
}

export const UNLIMITED_SOURCE = Number.MAX_SAFE_INTEGER;

export function projectRate(state: TimelineState): ExactRate {
  return exactRate(state.project.frame_rate);
}


export function findRow(state: TimelineState, rowId: unknown): RowRecord {
  const row = state.rows.find((candidate) => candidate.id === rowId);
  if (!row) throw ApiError.validation({ row_id: 'That value is not allowed here.' });
  return row;
}

export function findClip(state: TimelineState, clipId: unknown): EngineClip {
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw ApiError.validation({ clip_id: 'That value is not allowed here.' });
  return clip;
}

export function findCaption(state: TimelineState, captionId: unknown): EngineCaption {
  const caption = state.captions.find((candidate) => candidate.id === captionId);
  if (!caption) throw ApiError.validation({ caption_id: 'That value is not allowed here.' });
  return caption;
}


export function rowLocked(state: TimelineState, rowId: string): ApiError | null {
  const row = findRow(state, rowId);
  return row.locked ? ApiError.of('row_locked', { row_name: row.name }) : null;
}

export function requireUnlockedRow(state: TimelineState, rowId: string): RowRecord {
  const row = findRow(state, rowId);
  if (row.locked) throw ApiError.of('row_locked', { row_name: row.name });
  return row;
}

export function kindFitsRow(kind: ClipKind, rowKind: RowKind): boolean {
  if (kind === 'wav') return rowKind === 'audio';
  return rowKind === 'video';
}

export function sourceLimit(ctx: EngineContext, clip: EngineClip): number {
  if (clip.kind === 'text' || clip.media_id === null) return UNLIMITED_SOURCE;
  const media = ctx.media.get(clip.media_id);
  if (!media) return UNLIMITED_SOURCE;
  return media.source_frames[ctx.state.project.frame_rate];
}

/** A clip's length is its source span scaled by speed, by the rounding rule. */
export function lengthFromSource(sourceSpan: number, speedPercent: number): number {
  return Math.max(1, roundRational(BigInt(sourceSpan) * 100n, BigInt(speedPercent)));
}

/** A timeline delta in frames turned into a source delta by the clip's speed. */
export function sourceDelta(timelineDelta: number, speedPercent: number): number {
  const sign = timelineDelta < 0 ? -1n : 1n;
  return Number(sign) * roundRational(BigInt(Math.abs(timelineDelta)) * BigInt(speedPercent), 100n);
}

export function clipsOnRow(state: TimelineState, rowId: string, except: readonly string[] = []): EngineClip[] {
  return state.clips
    .filter((clip) => clip.row_id === rowId && !except.includes(clip.id))
    .sort((a, b) => a.start_frame - b.start_frame);
}

export function captionsOnRow(state: TimelineState, rowId: string, except: readonly string[] = []): EngineCaption[] {
  return state.captions
    .filter((caption) => caption.row_id === rowId && !except.includes(caption.id))
    .sort((a, b) => a.start_frame - b.start_frame);
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function clipBlocker(
  state: TimelineState,
  rowId: string,
  start: number,
  end: number,
  except: readonly string[],
): EngineClip | null {
  return clipsOnRow(state, rowId, except).find((clip) => overlaps(start, end, clip.start_frame, clip.end_frame)) ?? null;
}

export function captionBlocker(
  state: TimelineState,
  rowId: string,
  start: number,
  end: number,
  except: readonly string[],
): EngineCaption | null {
  return (
    captionsOnRow(state, rowId, except).find((caption) =>
      overlaps(start, end, caption.start_frame, caption.end_frame),
    ) ?? null
  );
}

/** Timeline order is by start frame, then by row position, then by clip id. */
export function timelineOrder(state: TimelineState): EngineClip[] {
  const position = new Map(state.rows.map((row) => [row.id, row.position]));
  return [...state.clips].sort(
    (a, b) =>
      a.start_frame - b.start_frame ||
      (position.get(a.row_id) ?? 0) - (position.get(b.row_id) ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

export function groupMembers(state: TimelineState, groupId: string): EngineClip[] {
  return timelineOrder(state).filter((clip) => clip.group_id === groupId);
}

export function totalFrames(clips: readonly { end_frame: number }[], captions: readonly { end_frame: number }[]): number {
  let largest = 0;
  for (const clip of clips) largest = Math.max(largest, clip.end_frame);
  for (const caption of captions) largest = Math.max(largest, caption.end_frame);
  return largest;
}

export interface MoveLimit {
  start: number;
  stopped: StoppedInfo | null;
}

/**
 * A move on the same row stops on the nearest free frame in the direction of
 * travel. A move that cannot go a single frame is blocked.
 */
export function limitMoveOnRow(state: TimelineState, clip: EngineClip, desiredStart: number): MoveLimit {
  const length = clip.end_frame - clip.start_frame;
  let target = desiredStart;
  let reason: string | null = null;
  if (target < 0) {
    target = 0;
    reason = BLOCKER.timelineStarts;
  }
  const others = clipsOnRow(state, clip.row_id, [clip.id]);
  if (target > clip.start_frame) {
    const ahead = others.filter((other) => other.start_frame >= clip.end_frame);
    const blocker = ahead.length > 0 ? ahead[0] : null;
    if (blocker && target + length > blocker.start_frame) {
      target = blocker.start_frame - length;
      reason = BLOCKER.inTheWay(blocker.name);
    }
  } else if (target < clip.start_frame) {
    const behind = others.filter((other) => other.end_frame <= clip.start_frame);
    const blocker = behind.length > 0 ? behind[behind.length - 1] : null;
    if (blocker && target < blocker.end_frame) {
      target = blocker.end_frame;
      reason = BLOCKER.inTheWay(blocker.name);
    }
  }
  if (reason !== null && target === clip.start_frame) {
    throw ApiError.of('blocked', { clip_name: clip.name, reason });
  }
  return { start: target, stopped: reason === null ? null : { at_frame: target, reason } };
}

/** Why a group member cannot take the whole delta, or null when it can. */
export function groupMoveRefusal(state: TimelineState, members: readonly EngineClip[], delta: number): string | null {
  const memberIds = members.map((member) => member.id);
  for (const member of members) {
    const row = findRow(state, member.row_id);
    if (row.locked) return BLOCKER.rowLocked(row.name);
    const start = member.start_frame + delta;
    if (start < 0) return BLOCKER.timelineStarts;
    const blocker = clipBlocker(state, member.row_id, start, start + (member.end_frame - member.start_frame), memberIds);
    if (blocker) return BLOCKER.inTheWay(blocker.name);
  }
  return null;
}

export interface Bound {
  limit: number;
  reason: string;
}

export function clampWithReason(
  desired: number,
  maxima: readonly Bound[],
  minima: readonly Bound[],
): { value: number; stoppedReason: string | null } {
  let value = desired;
  let stoppedReason: string | null = null;
  const tightestMax = maxima.reduce<Bound | null>((best, bound) => (best === null || bound.limit < best.limit ? bound : best), null);
  const tightestMin = minima.reduce<Bound | null>((best, bound) => (best === null || bound.limit > best.limit ? bound : best), null);
  if (tightestMax && value > tightestMax.limit) {
    value = tightestMax.limit;
    stoppedReason = tightestMax.reason;
  }
  if (tightestMin && value < tightestMin.limit) {
    value = tightestMin.limit;
    stoppedReason = tightestMin.reason;
  }
  return { value, stoppedReason };
}

export function cloneState(state: TimelineState): TimelineState {
  return structuredClone(state);
}

export function asLayerClip(clip: EngineClip, media: Map<string, MediaInfo>): LayerClip {
  const info = clip.media_id === null ? undefined : media.get(clip.media_id);
  return { ...clip, media_width: info?.width ?? null, media_height: info?.height ?? null };
}

export function emptyBase(): LayerBase {
  return { x: null, y: null, scale: null, rotation: null, opacity: null };
}
