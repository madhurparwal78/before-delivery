export interface RankedCommand {
  name: string;
  score: number;
}

/** Case-insensitive subsequence match taking each query character leftmost: 100 - first index - (span - query length). */
export function commandScore(name: string, query: string): number | null {
  const haystack = name.toLowerCase();
  const wanted = query.toLowerCase();
  let at = -1;
  let first = -1;
  for (const char of wanted) {
    at = haystack.indexOf(char, at + 1);
    if (at < 0) return null;
    if (first < 0) first = at;
  }
  return wanted === '' ? 0 : 100 - first - (at - first + 1 - wanted.length);
}

export function rankCommands(names: readonly string[], query: string): RankedCommand[] {
  const lower = (value: string): string => value.toLowerCase();
  return names
    .flatMap((name) => {
      const score = commandScore(name, query);
      return score === null ? [] : [{ name, score }];
    })
    .sort((a, b) => b.score - a.score || (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0));
}
