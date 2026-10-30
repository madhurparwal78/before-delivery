/** The one definition of how highlights follow a note body edit. */

export interface AnchoredSpan {
  id: string;
  start: number;
  end: number;
  quote: string;
}

export interface ReanchorResult {
  moved: { id: string; start: number; end: number }[];
  lost: string[];
}

export function reanchorSpans(spans: readonly AnchoredSpan[], text: string): ReanchorResult {
  const moved: { id: string; start: number; end: number }[] = [];
  const lost: string[] = [];
  for (const span of spans) {
    if (text.slice(span.start, span.end) === span.quote) {
      moved.push({ id: span.id, start: span.start, end: span.end });
      continue;
    }
    const start = closestOccurrence(text, span.quote, span.start);
    if (start === null) lost.push(span.id);
    else moved.push({ id: span.id, start, end: start + span.quote.length });
  }
  return { moved, lost };
}

function closestOccurrence(text: string, quote: string, oldStart: number): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let index = text.indexOf(quote);
  while (index !== -1) {
    const distance = Math.abs(index - oldStart);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
    index = text.indexOf(quote, index + 1);
  }
  return best;
}
