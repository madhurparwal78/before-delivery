/**
 * Citation resolution. For figure F and date D the citation is F's computation
 * with the greatest computed_at strictly earlier than the New York midnight
 * that ends D.
 */
import { transact } from './db';
import { FIGURE_KEYS, FigureKey } from '../shared/labels';
import { endOfDayExclusive, newYorkDateStringOf, parseDateString } from '../shared/nytime';
import { marketClockNow } from './marketClock';
import { ComputationPayload, computationBefore } from './computations';

export interface CitationResult {
  figure: FigureKey;
  date: string;
  provisional: boolean;
  computation: ComputationPayload;
}

export async function resolveCitation(
  figure: string,
  dateString: string,
): Promise<CitationResult | null> {
  if (!(FIGURE_KEYS as readonly string[]).includes(figure)) return null;
  const date = parseDateString(dateString);
  if (date === null) return null;
  const nowMs = await marketClockNow();
  const marketDate = newYorkDateStringOf(nowMs);
  if (dateString > marketDate) return null;
  const boundary = endOfDayExclusive(date);
  return transact(async (tx) => {
    const computation = await computationBefore(tx, figure as FigureKey, boundary);
    if (computation === null) return null;
    return {
      figure: figure as FigureKey,
      date: dateString,
      provisional: dateString === marketDate,
      computation,
    };
  });
}
