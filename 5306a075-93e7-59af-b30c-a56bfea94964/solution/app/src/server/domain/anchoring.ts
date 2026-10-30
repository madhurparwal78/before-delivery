// Highlights through edits (brief: Business rules › Highlights through edits).

export interface Anchored { id: string; start: number; end: number; quote: string }

export type Reanchor =
  | { ok: true; moved: Anchored[] }
  | { ok: false; lostIds: string[] };

/** Keeps each insight on its quote in the new text: same place, else the nearest occurrence (earlier wins a tie). */
export function reanchor(insights: readonly Anchored[], text: string): Reanchor {
  const moved: Anchored[] = [];
  const lost: Anchored[] = [];
  for (const insight of insights) {
    if (text.slice(insight.start, insight.end) === insight.quote) continue;
    let best: number | null = null;
    for (let at = text.indexOf(insight.quote); at >= 0; at = text.indexOf(insight.quote, at + 1)) {
      if (best === null || Math.abs(at - insight.start) < Math.abs(best - insight.start)) best = at;
    }
    if (best === null) lost.push(insight);
    else moved.push({ ...insight, start: best, end: best + insight.quote.length });
  }
  if (lost.length > 0) {
    return { ok: false, lostIds: lost.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1)).map((i) => i.id) };
  }
  return { ok: true, moved };
}
