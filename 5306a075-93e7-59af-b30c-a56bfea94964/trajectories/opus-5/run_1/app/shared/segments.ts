/**
 * The single definition of highlight segmentation: the longest runs of a note's
 * plain text over which the set of covering spans does not change.
 */

export interface HighlightSpan {
  /** Saved insight id, or null for the pending selection. */
  insightId: string | null;
  start: number;
  end: number;
}

export interface HighlightSegment {
  start: number;
  end: number;
  /** Saved insight ids covering the run, sorted as strings. */
  insightIds: string[];
  pending: boolean;
}

export function computeHighlightSegments(spans: readonly HighlightSpan[]): HighlightSegment[] {
  if (spans.length === 0) return [];
  const edges = new Set<number>();
  for (const span of spans) {
    edges.add(span.start);
    edges.add(span.end);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const segments: HighlightSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start >= end) continue;
    const covering = spans.filter((span) => span.start <= start && span.end >= end);
    if (covering.length === 0) continue;
    const insightIds = covering
      .map((span) => span.insightId)
      .filter((id): id is string => id !== null)
      .sort();
    segments.push({ start, end, insightIds, pending: covering.some((span) => span.insightId === null) });
  }
  return segments;
}
