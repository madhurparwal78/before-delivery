// Search matching: an exact substring, ignoring case. Pure, so it is tested alone.

interface LineMatch {
  readonly line: number;
  readonly text: string;
}

/** The lines of a file that contain `needle`, in line order. */
export function matchingLines(content: string, needle: string): LineMatch[] {
  if (needle === "") return [];
  const wanted = needle.toLowerCase();
  const found: LineMatch[] = [];
  const lines = content.split("\n");
  lines.forEach((text, index) => {
    const line = text.endsWith("\r") ? text.slice(0, -1) : text;
    if (line.toLowerCase().includes(wanted)) found.push({ line: index + 1, text: line });
  });
  return found;
}

export interface CodeHit {
  readonly project: string;
  readonly path: string;
  readonly line: number;
}

/** Results sort by path and then line; the project path only separates equal ones. */
export function compareHits(a: CodeHit, b: CodeHit): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.project !== b.project) return a.project < b.project ? -1 : 1;
  return 0;
}
