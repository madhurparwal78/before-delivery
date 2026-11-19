/** Changed text is compared word by word, split on white space. */
export interface WordDiff {
  removed: string[];
  added: string[];
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

export function diffWords(older: string, newer: string): WordDiff {
  const a = words(older);
  const b = words(newer);
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lengths[i];
      const next = lengths[i + 1];
      if (!row || !next) continue;
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const down = lengths[i + 1]?.[j] ?? 0;
    const right = lengths[i]?.[j + 1] ?? 0;
    if (down >= right) {
      const word = a[i];
      if (word !== undefined) removed.push(word);
      i += 1;
    } else {
      const word = b[j];
      if (word !== undefined) added.push(word);
      j += 1;
    }
  }
  while (i < a.length) {
    const word = a[i];
    if (word !== undefined) removed.push(word);
    i += 1;
  }
  while (j < b.length) {
    const word = b[j];
    if (word !== undefined) added.push(word);
    j += 1;
  }
  return { removed, added };
}
