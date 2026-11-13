/** The project page's state and its single path for sending ops. */
import { ApiCallError, newOpId, post } from '../api.js';
import { exactRate, timecode, type ExactRate, type FrameRateName } from '../../domain/rate.js';
import { notice } from '../shell.js';
import type { MediaIndex, ProjectDetail } from '../sheet.js';
import type {
  CommentRecord,
  CutRecord,
  ExportRecord,
  KitRecord,
  OpChanges,
  OpResult,
  Person,
  ProjectRecord,
  Role,
} from '../../shared/types.js';

export type Panel = 'inspector' | 'comments' | 'exports' | 'none';
export type Layout = 'review-list' | 'two-pane' | 'editor';

export interface LoupeState {
  visible: boolean;
  pinned: boolean;
  frame: number;
  snapped: boolean;
  x: number;
  y: number;
  returnTo: string | null;
}

export interface PageState {
  projectId: string;
  detail: ProjectDetail;
  media: MediaIndex;
  comments: CommentRecord[];
  cuts: CutRecord[];
  exports: ExportRecord[];
  kits: KitRecord[];
  members: { person: Person; role: Role }[];
  version: number;
  playhead: number;
  zoom: number;
  firstFrame: number;
  visibleFrames: number;
  currentClipId: string | null;
  selection: Set<string>;
  panel: Panel;
  layout: Layout;
  loupe: LoupeState;
  stageMode: 'playhead' | 'skim';
  stageFrame: number;
  stageGuide: string | null;
  playing: boolean;
  playFrom: number;
  playStartedAt: number;
  rangeIn: number | null;
  rangeOut: number | null;
  remotePlayheads: Map<string, number>;
  winners: Map<string, string>;
  replyTo: string | null;
  noteVisibility: 'team' | 'review';
  noteBody: string;
  scrubberFrame: number;
}

export const PX_PER_FRAME = [0.25, 0.5, 1, 2, 4, 8] as const;
export const DEFAULT_ZOOM = 2;
export const SNAP_FRAMES = 2;
export const NOTE_LIMIT = 2000;

export function rateOf(state: PageState): ExactRate {
  return exactRate(state.detail.project.frame_rate as FrameRateName);
}

export function stamp(state: PageState, frame: number): string {
  return timecode(frame, rateOf(state));
}

export function lockedRows(state: PageState): Set<string> {
  return new Set(state.detail.rows.filter((row) => row.locked).map((row) => row.id));
}


/** Timeline order is by start frame, then by row position, then by clip id. */
export function timelineOrder(state: PageState): (ProjectDetail['clips'][number])[] {
  const positions = new Map(state.detail.rows.map((row) => [row.id, row.position]));
  return [...state.detail.clips].sort(
    (a, b) =>
      a.start_frame - b.start_frame ||
      (positions.get(a.row_id) ?? 0) - (positions.get(b.row_id) ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

export function clipById(state: PageState, clipId: string | null): (ProjectDetail['clips'][number]) | undefined {
  if (clipId === null) return undefined;
  return state.detail.clips.find((clip) => clip.id === clipId);
}

export function totalFrames(state: PageState): number {
  let largest = 0;
  for (const clip of state.detail.clips) largest = Math.max(largest, clip.end_frame);
  for (const caption of state.detail.captions) largest = Math.max(largest, caption.end_frame);
  return largest;
}

export function lastFrame(state: PageState): number {
  return Math.max(0, totalFrames(state) - 1);
}

export function applyChanges(state: PageState, changes: OpChanges, removed: string[]): void {
  for (const clip of changes.clips) {
    const at = state.detail.clips.findIndex((candidate) => candidate.id === clip.id);
    const typed = clip as ProjectDetail['clips'][number];
    if (at >= 0) state.detail.clips[at] = typed;
    else state.detail.clips.push(typed);
  }
  for (const caption of changes.captions) {
    const at = state.detail.captions.findIndex((candidate) => candidate.id === caption.id);
    if (at >= 0) state.detail.captions[at] = caption;
    else state.detail.captions.push(caption);
  }
  for (const row of changes.rows) {
    const at = state.detail.rows.findIndex((candidate) => candidate.id === row.id);
    if (at >= 0) state.detail.rows[at] = row;
    else state.detail.rows.push(row);
  }
  for (const comment of changes.comments) {
    const at = state.comments.findIndex((candidate) => candidate.id === comment.id);
    if (at >= 0) state.comments[at] = comment;
    else state.comments.push(comment);
  }
  if (removed.length > 0) {
    state.detail.clips = state.detail.clips.filter((clip) => !removed.includes(clip.id));
    state.detail.captions = state.detail.captions.filter((caption) => !removed.includes(caption.id));
    state.detail.rows = state.detail.rows.filter((row) => !removed.includes(row.id));
  }
}

export interface SendOptions {
  /** copy for a stop, built from the response */
  onStopped?: (result: OpResult) => void;
}

export type Redraw = () => void;

/** Every timeline change goes through one op. */
export async function sendOp(
  state: PageState,
  body: Record<string, unknown>,
  redraw: Redraw,
  options: SendOptions = {},
): Promise<OpResult | null> {
  try {
    const result = await post<OpResult>(`/api/projects/${state.projectId}/ops`, {
      op_id: newOpId(),
      base_version: state.version,
      ...body,
    });
    state.version = result.version;
    applyChanges(state, result.changes, result.removed);
    if (result.project !== undefined) state.detail.project = result.project as ProjectRecord;
    if (result.stopped !== null) {
      notice(`Stopped at ${stamp(state, result.stopped.at_frame)}: ${result.stopped.reason}.`);
      options.onStopped?.(result);
    }
    redraw();
    return result;
  } catch (error) {
    if (error instanceof ApiCallError) {
      notice(error.failure.message);
      if (error.failure.status === 412 && Array.isArray(error.failure.items)) {
        applyChanges(
          state,
          { clips: error.failure.items as OpChanges['clips'], captions: [], comments: [], rows: [] },
          [],
        );
        if (error.failure.winner !== undefined) {
          for (const item of error.failure.items as { id: string }[]) {
            state.winners.set(item.id, error.failure.winner);
          }
          window.setTimeout(() => {
            for (const item of error.failure.items as { id: string }[]) state.winners.delete(item.id);
            redraw();
          }, 2000);
        }
        redraw();
      }
    }
    return null;
  }
}

export function freshLoupe(): LoupeState {
  return { visible: false, pinned: false, frame: 0, snapped: false, x: 0, y: 0, returnTo: null };
}

