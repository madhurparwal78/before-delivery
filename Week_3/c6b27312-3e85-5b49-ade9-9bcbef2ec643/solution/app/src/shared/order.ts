// House rule H3: every text key compares by Unicode code point of its stored (composed) form.

export function compareText(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) as number;
    const y = b.codePointAt(j) as number;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  const restA = a.length - i;
  const restB = b.length - j;
  return restA === restB ? 0 : restA < restB ? -1 : 1;
}

type SortKey = readonly (string | number)[];

/** Compares sort keys element by element: text by code point, numbers numerically. */
export function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as string | number;
    const y = b[i] as string | number;
    if (x === y) continue;
    if (typeof x === "string" && typeof y === "string") {
      const c = compareText(x, y);
      if (c !== 0) return c;
    } else {
      return (x as number) < (y as number) ? -1 : 1;
    }
  }
  return 0;
}
