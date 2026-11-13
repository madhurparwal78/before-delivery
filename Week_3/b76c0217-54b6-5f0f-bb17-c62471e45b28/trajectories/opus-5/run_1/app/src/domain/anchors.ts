/** The one anchor rule for h2 and h3 headings. */
export function anchorFor(headingText: string): string {
  const kept = headingText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return kept === '' ? 'section' : kept;
}

/** Repeated anchors on one page get -2, -3 and on, in page order. */
export function uniqueAnchors(headingTexts: readonly string[]): string[] {
  const used = new Map<string, number>();
  return headingTexts.map((text) => {
    const base = anchorFor(text);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  });
}
