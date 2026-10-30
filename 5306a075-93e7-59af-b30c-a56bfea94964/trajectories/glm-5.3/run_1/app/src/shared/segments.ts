/**
 * Highlight segmentation (DP-52). Saved insights plus an optional pending
 * span are cut into the longest runs with a constant covering set, then
 * split at element boundaries so no mark crosses one.
 */

export interface InsightSpan {
  id: string;
  start: number;
  end: number;
}

export interface PendingSpan {
  start: number;
  end: number;
}

export interface BodySegment {
  /** Plain-text offset of the segment start, end exclusive. */
  start: number;
  end: number;
  /** Insight ids covering the run, sorted as strings. */
  insights: string[];
  pending: boolean;
  /** Index of the text piece within this segment's element. */
  pieceIndex: number;
  /** How many pieces this segment is split into. */
  pieceCount: number;
}

/**
 * A run of the plain text over which the set of covering spans is constant.
 * `inPre` records whether the run lies inside a `pre` block (no trimming).
 */
interface Run {
  start: number;
  end: number;
  insights: string[];
  pending: boolean;
}

/** Find the longest runs with a constant covering set. */
function computeRuns(spans: InsightSpan[], pending: PendingSpan | null, textLength: number): Run[] {
  const boundaries = new Set<number>();
  boundaries.add(0);
  boundaries.add(textLength);
  for (const s of spans) {
    boundaries.add(s.start);
    boundaries.add(s.end);
  }
  if (pending !== null) {
    boundaries.add(pending.start);
    boundaries.add(pending.end);
  }
  const points = [...boundaries].filter((p) => p >= 0 && p <= textLength).sort((a, b) => a - b);

  const runs: Run[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;
    const covering: string[] = [];
    for (const s of spans) {
      if (s.start <= start && end <= s.end) covering.push(s.id);
    }
    covering.sort((a, b) => (a < b ? -1 : 1));
    const isPending =
      pending !== null && pending.start <= start && end <= pending.end;
    if (covering.length === 0 && !isPending) continue;
    runs.push({ start, end, insights: covering, pending: isPending });
  }
  return runs;
}

export interface ElementPiece {
  /** Plain-text offsets covered by this piece of the run. */
  start: number;
  end: number;
  pieceIndex: number;
  pieceCount: number;
}

/**
 * Segment a note's plain text for mark rendering. Runs that cross an element
 * boundary of the rendered body are reported as several contiguous pieces.
 */
export function segmentHighlights(
  textLength: number,
  spans: InsightSpan[],
  pending: PendingSpan | null,
  boundaries: number[],
): BodySegment[] {
  const runs = computeRuns(spans, pending, textLength);
  const cuts = [...boundaries].filter((b) => b > 0 && b < textLength).sort((a, b) => a - b);
  const segments: BodySegment[] = [];
  for (const run of runs) {
    const inner = cuts.filter((c) => c > run.start && c < run.end);
    const edges = [run.start, ...inner, run.end];
    for (let i = 0; i + 1 < edges.length; i++) {
      segments.push({
        start: edges[i]!,
        end: edges[i + 1]!,
        insights: run.insights,
        pending: run.pending,
        pieceIndex: i,
        pieceCount: edges.length - 1,
      });
    }
  }
  return segments;
}

/**
 * A mark edge that would split a surrogate pair moves outward by one, so a
 * whole character is always covered (DP-04, DP-51).
 */
export function snapOutward(text: string, offset: number, towardEnd: boolean): number {
  const len = text.length;
  if (offset <= 0) return 0;
  if (offset >= len) return len;
  const prev = text.charCodeAt(offset - 1);
  const cur = text.charCodeAt(offset);
  const prevIsHigh = prev >= 0xd800 && prev <= 0xdbff;
  const curIsLow = cur >= 0xdc00 && cur <= 0xdfff;
  if (prevIsHigh && curIsLow) {
    // offset sits between the halves of a pair.
    return towardEnd ? Math.min(offset + 1, len) : Math.max(offset - 1, 0);
  }
  return offset;
}

/** True when [start, end) would split a surrogate pair at either edge. */
export function splitsSurrogatePair(text: string, start: number, end: number): boolean {
  const atStart = snapOutward(text, start, false) !== start;
  const atEnd = snapOutward(text, end, true) !== end;
  return atStart || atEnd;
}
