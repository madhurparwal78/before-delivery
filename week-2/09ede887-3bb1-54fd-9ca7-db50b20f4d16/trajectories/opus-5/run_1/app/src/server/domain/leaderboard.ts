export interface GuessRow {
  readonly id: number;
  readonly name: string;
  readonly value: number;
  readonly createdAt: Date;
}

export interface Leader {
  readonly rank: number;
  readonly displayName: string;
  readonly value: number;
  readonly distance: number;
}

/** First word, a space, then the last word's initial and a full stop. */
export function displayName(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? '';
  if (words.length < 2) return first;
  const last = words[words.length - 1] as string;
  return `${first} ${(last[0] ?? '').toUpperCase()}.`;
}

/** Closest first, then earlier `created_at`, then lower guess id; at most three. */
export function rankGuesses(guesses: readonly GuessRow[], finalFigure: number): Leader[] {
  return [...guesses]
    .sort((left, right) => {
      const distance = Math.abs(left.value - finalFigure) - Math.abs(right.value - finalFigure);
      if (distance !== 0) return distance;
      const created = left.createdAt.getTime() - right.createdAt.getTime();
      if (created !== 0) return created;
      return left.id - right.id;
    })
    .slice(0, 3)
    .map((guess, index) => ({
      rank: index + 1,
      displayName: displayName(guess.name),
      value: guess.value,
      distance: Math.abs(guess.value - finalFigure),
    }));
}
