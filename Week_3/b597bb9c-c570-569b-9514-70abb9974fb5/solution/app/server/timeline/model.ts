import type { FrameRate } from "../../shared/rational";
import type { AspectRatio, Caption, Clip, Marker, MediaKind, Row } from "../../shared/types";
import { BLOCKER } from "../../shared/copy";
import { AppError } from "../errors";

export interface RowRec extends Row {
  srt_eol: string;
  srt_bom: boolean;
}

export interface CaptionRec extends Caption {
  orig_start_ms: number | null;
  orig_end_ms: number | null;
}

/** The facts about a library file the timeline needs: its source length as an exact rational of seconds. */
export interface MediaInfo {
  id: string;
  name: string;
  kind: MediaKind;
  width: number | null;
  height: number | null;
  src_num: bigint;
  src_den: bigint;
}

export interface Timeline {
  projectId: string;
  rate: FrameRate;
  aspect: AspectRatio;
  rows: RowRec[];
  clips: Clip[];
  captions: CaptionRec[];
  markers: Marker[];
}

type Kept<T> = Map<string, T | null>;

/** A working copy of a timeline that remembers the original of everything it touches. */
export class Draft {
  readonly projectId: string;
  readonly rate: FrameRate;
  readonly rows = new Map<string, RowRec>();
  readonly clips = new Map<string, Clip>();
  readonly captions = new Map<string, CaptionRec>();
  markers: Marker[];
  aspect: AspectRatio;
  private readonly firstRows: Kept<RowRec> = new Map();
  private readonly firstClips: Kept<Clip> = new Map();
  private readonly firstCaptions: Kept<CaptionRec> = new Map();
  private firstMarkers: Marker[] | null = null;
  private firstAspect: AspectRatio | null = null;

  constructor(timeline: Timeline) {
    this.projectId = timeline.projectId;
    this.rate = timeline.rate;
    this.aspect = timeline.aspect;
    this.markers = structuredClone(timeline.markers);
    for (const row of timeline.rows) this.rows.set(row.id, structuredClone(row));
    for (const clip of timeline.clips) this.clips.set(clip.id, structuredClone(clip));
    for (const caption of timeline.captions) this.captions.set(caption.id, structuredClone(caption));
  }

  rowsInOrder(): RowRec[] {
    return [...this.rows.values()].sort((a, b) => a.position - b.position);
  }

  row(id: string): RowRec {
    const row = this.rows.get(id);
    if (!row) throw new AppError("not_found");
    return row;
  }

  clip(id: string): Clip {
    const clip = this.clips.get(id);
    if (!clip) throw new AppError("not_found");
    return clip;
  }

  caption(id: string): CaptionRec {
    const caption = this.captions.get(id);
    if (!caption) throw new AppError("not_found");
    return caption;
  }

  /** Records the original of a row before it is first changed, and returns the live copy to change. */
  editRow(id: string): RowRec {
    const row = this.row(id);
    if (!this.firstRows.has(id)) this.firstRows.set(id, structuredClone(row));
    return row;
  }

  putRow(row: RowRec): void {
    if (!this.firstRows.has(row.id)) this.firstRows.set(row.id, this.rows.get(row.id) ? structuredClone(this.row(row.id)) : null);
    this.rows.set(row.id, row);
  }

  editClip(id: string): Clip {
    const clip = this.clip(id);
    if (!this.firstClips.has(id)) this.firstClips.set(id, structuredClone(clip));
    return clip;
  }

  putClip(clip: Clip): void {
    if (!this.firstClips.has(clip.id)) this.firstClips.set(clip.id, this.clips.get(clip.id) ? structuredClone(this.clip(clip.id)) : null);
    this.clips.set(clip.id, clip);
  }

  dropClip(id: string): void {
    this.editClip(id);
    this.clips.delete(id);
  }

  editCaption(id: string): CaptionRec {
    const caption = this.caption(id);
    if (!this.firstCaptions.has(id)) this.firstCaptions.set(id, structuredClone(caption));
    return caption;
  }

  putCaption(caption: CaptionRec): void {
    if (!this.firstCaptions.has(caption.id)) {
      this.firstCaptions.set(caption.id, this.captions.get(caption.id) ? structuredClone(this.caption(caption.id)) : null);
    }
    this.captions.set(caption.id, caption);
  }

  dropCaption(id: string): void {
    this.editCaption(id);
    this.captions.delete(id);
  }

  setMarkers(markers: Marker[]): void {
    this.firstMarkers ??= structuredClone(this.markers);
    this.markers = markers;
  }

  setAspect(aspect: AspectRatio): void {
    this.firstAspect ??= this.aspect;
    this.aspect = aspect;
  }

  /** Everything that differs from the original: the persisted change set, the originals and what was created or removed. */
  diff(): Diff {
    const changedClips: Clip[] = [];
    const changedCaptions: CaptionRec[] = [];
    const changedRows: RowRec[] = [];
    const removed: string[] = [];
    const clipBefore = new Map<string, Clip | null>();
    const captionBefore = new Map<string, CaptionRec | null>();
    const rowBefore = new Map<string, RowRec | null>();
    for (const [id, before] of this.firstClips) {
      const now = this.clips.get(id) ?? null;
      if (JSON.stringify(before) === JSON.stringify(now)) continue;
      clipBefore.set(id, before);
      if (now) changedClips.push(now);
      else removed.push(id);
    }
    for (const [id, before] of this.firstCaptions) {
      const now = this.captions.get(id) ?? null;
      if (JSON.stringify(before) === JSON.stringify(now)) continue;
      captionBefore.set(id, before);
      if (now) changedCaptions.push(now);
      else removed.push(id);
    }
    for (const [id, before] of this.firstRows) {
      const now = this.rows.get(id) ?? null;
      if (JSON.stringify(before) === JSON.stringify(now)) continue;
      rowBefore.set(id, before);
      if (now) changedRows.push(now);
      else removed.push(id);
    }
    const markersChanged = this.firstMarkers !== null && JSON.stringify(this.firstMarkers) !== JSON.stringify(this.markers);
    const aspectChanged = this.firstAspect !== null && this.firstAspect !== this.aspect;
    return {
      clips: changedClips,
      captions: changedCaptions,
      rows: changedRows,
      removed,
      clipBefore,
      captionBefore,
      rowBefore,
      markersBefore: markersChanged ? this.firstMarkers : null,
      aspectBefore: aspectChanged ? this.firstAspect : null,
    };
  }
}

export interface Diff {
  clips: Clip[];
  captions: CaptionRec[];
  rows: RowRec[];
  removed: string[];
  clipBefore: Map<string, Clip | null>;
  captionBefore: Map<string, CaptionRec | null>;
  rowBefore: Map<string, RowRec | null>;
  markersBefore: Marker[] | null;
  aspectBefore: AspectRatio | null;
}

function byTimelineOrder(rows: readonly RowRec[]): (a: Clip, b: Clip) => number {
  const position = new Map(rows.map((row) => [row.id, row.position]));
  return (a, b) =>
    a.start_frame - b.start_frame || (position.get(a.row_id) ?? 0) - (position.get(b.row_id) ?? 0) || (a.id < b.id ? -1 : 1);
}

export function clipsOnRow(draft: Draft, rowId: string): Clip[] {
  return [...draft.clips.values()].filter((clip) => clip.row_id === rowId).sort((a, b) => a.start_frame - b.start_frame);
}

export function groupMembers(draft: Draft, groupId: string): Clip[] {
  return [...draft.clips.values()].filter((clip) => clip.group_id === groupId).sort(byTimelineOrder([...draft.rows.values()]));
}

/** Two half-open frame ranges share at least one frame. */
export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && bStart < aEnd;

/** The first clip on the row occupying any frame in [start, end), ignoring the listed ids. */
export function findOverlap(draft: Draft, rowId: string, start: number, end: number, ignore: ReadonlySet<string>): Clip | null {
  for (const clip of clipsOnRow(draft, rowId)) {
    if (!ignore.has(clip.id) && overlaps(clip.start_frame, clip.end_frame, start, end)) return clip;
  }
  return null;
}

export function assertUnlocked(draft: Draft, rowId: string): void {
  const row = draft.row(rowId);
  if (row.locked) throw new AppError("row_locked", { row: row.name });
}

export function timelineLength(draft: Draft): number {
  let total = 0;
  for (const clip of draft.clips.values()) total = Math.max(total, clip.end_frame);
  for (const caption of draft.captions.values()) total = Math.max(total, caption.end_frame);
  return total;
}

export function blockedBy(clip: Clip, reason: string): AppError {
  return new AppError("blocked", { clip: clip.name, reason });
}

export const inTheWay = (other: Clip): string => BLOCKER.inTheWay(other.name);
