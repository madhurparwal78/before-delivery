export interface CommandItem {
  name: string;
  kind: 'tool' | 'layer' | 'frame' | 'swatch';
  value: string;
}

export interface RankedCommand extends CommandItem {
  score: number;
}

interface Match {
  first: number;
  span: number;
}

function matchQuery(name: string, query: string): Match | null {
  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();
  let at = -1;
  let first = -1;
  for (const character of needle) {
    at = haystack.indexOf(character, at + 1);
    if (at === -1) return null;
    if (first === -1) first = at;
  }
  return { first, span: at - first + 1 };
}

/** Case-insensitive subsequence match, scored by the published rule. */
export function rankCommands(items: CommandItem[], query: string): RankedCommand[] {
  if (query === '') {
    return [...items]
      .sort((l, r) => l.name.toLowerCase().localeCompare(r.name.toLowerCase()))
      .map((item) => ({ ...item, score: 100 }));
  }
  const ranked: RankedCommand[] = [];
  for (const item of items) {
    const match = matchQuery(item.name, query);
    if (match === null) continue;
    ranked.push({ ...item, score: 100 - match.first - (match.span - query.length) });
  }
  ranked.sort((l, r) =>
    r.score === l.score ? l.name.toLowerCase().localeCompare(r.name.toLowerCase()) : r.score - l.score,
  );
  return ranked;
}
