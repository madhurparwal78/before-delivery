export interface Rankable {
  entryId: string;
  entryNumber: number;
  submittedAt: Date | null;
  score: number | null;
  ideaMean: number | null;
}

/**
 * Score high to low with nulls last, then higher Idea mean, then earlier
 * submission, then lower entry number.
 */
export function compareForRank(a: Rankable, b: Rankable): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  const ideaA = a.ideaMean ?? -1;
  const ideaB = b.ideaMean ?? -1;
  if (ideaA !== ideaB) return ideaB - ideaA;
  const timeA = a.submittedAt === null ? Number.MAX_SAFE_INTEGER : a.submittedAt.getTime();
  const timeB = b.submittedAt === null ? Number.MAX_SAFE_INTEGER : b.submittedAt.getTime();
  if (timeA !== timeB) return timeA - timeB;
  return a.entryNumber - b.entryNumber;
}

export function cutFor(rank: number, cut: number): 'above' | 'below' {
  return rank <= cut ? 'above' : 'below';
}
