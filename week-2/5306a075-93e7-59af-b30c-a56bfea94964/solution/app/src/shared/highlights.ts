// Highlight segmentation: saved and pending spans become runs over which the covering set is constant,
// then each run is cut at every laid-out text piece, so marks never cross an element boundary.

export interface HighlightSpan {
  /** The saved insight's id, or null for the pending selection. */
  insightId: string | null;
  start: number;
  end: number;
}

export interface MarkSegment {
  start: number;
  end: number;
  insightIds: string[];
  pending: boolean;
}

/** Covered runs of the text, each with the sorted ids of the saved insights covering it. */
export function coveredRuns(spans: readonly HighlightSpan[]): MarkSegment[] {
  const edges = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  const runs: MarkSegment[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const start = edges[i] as number;
    const end = edges[i + 1] as number;
    const covering = spans.filter((s) => s.start <= start && end <= s.end);
    if (covering.length === 0) continue;
    const insightIds = covering.flatMap((s) => (s.insightId === null ? [] : [s.insightId])).sort();
    runs.push({ start, end, insightIds, pending: covering.some((s) => s.insightId === null) });
  }
  return runs;
}

/** One text piece cut into plain runs and mark runs. */
export interface PieceSlice {
  start: number;
  end: number;
  value: string;
  mark: MarkSegment | null;
}

export function slicePiece(piece: { value: string; start: number }, runs: readonly MarkSegment[]): PieceSlice[] {
  const end = piece.start + piece.value.length;
  const cuts = new Set([piece.start, end]);
  for (const run of runs) {
    if (run.start > piece.start && run.start < end) cuts.add(run.start);
    if (run.end > piece.start && run.end < end) cuts.add(run.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const slices: PieceSlice[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i] as number;
    const to = points[i + 1] as number;
    const mark = runs.find((r) => r.start <= from && to <= r.end) ?? null;
    slices.push({ start: from, end: to, value: piece.value.slice(from - piece.start, to - piece.start), mark });
  }
  return slices;
}
