// Closing keywords: `Closes #N`, `Fixes #N` and `Resolves #N` in any case.

const KEYWORD = /\b(?:closes|fixes|resolves)\s+#(\d+)\b/giu;

/** Issue iids named by closing keywords in these texts, ascending and without repeats. */
export function closingIssueIids(texts: readonly string[]): number[] {
  const found = new Set<number>();
  for (const text of texts) {
    for (const match of text.matchAll(KEYWORD)) {
      const iid = Number(match[1]);
      if (Number.isSafeInteger(iid) && iid > 0) found.add(iid);
    }
  }
  return [...found].sort((a, b) => a - b);
}
