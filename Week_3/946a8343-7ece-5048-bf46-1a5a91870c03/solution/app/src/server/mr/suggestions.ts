// Suggestion blocks in comments: parsing, the region they replace, and applying a batch to one file's text.

interface SuggestionBlock {
  readonly above: number;
  readonly below: number;
  readonly lines: readonly string[];
}

const OPENER = /^```suggestion(?::-(\d+)\+(\d+))?[ \t]*$/u;
const CLOSER = /^```[ \t]*$/u;

/** A fenced block opened by ```suggestion:-a+b (bare = -0+0) and closed by ```. An unclosed block is plain text. */
export function parseSuggestionBlocks(body: string): SuggestionBlock[] {
  const lines = body.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const blocks: SuggestionBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const opener = OPENER.exec(lines[index] ?? "");
    if (opener === null) {
      index++;
      continue;
    }
    let close = index + 1;
    while (close < lines.length && !CLOSER.test(lines[close] ?? "")) close++;
    if (close >= lines.length) break;
    blocks.push({ above: Number(opener[1] ?? "0"), below: Number(opener[2] ?? "0"), lines: lines.slice(index + 1, close) });
    index = close + 1;
  }
  return blocks;
}

interface LineRegion {
  readonly start: number;
  readonly end: number;
}

/** The lines a suggestion replaces: the commented lines plus `above` before and `below` after. */
export function suggestionRegion(start: number, end: number, block: Pick<SuggestionBlock, "above" | "below">): LineRegion {
  return { start: start - block.above, end: end + block.below };
}

export interface PlannedSuggestion {
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

interface Overlap {
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

/** The first pair of suggestions in one file whose regions share a line, as the span they cover together. */
export function findOverlap(planned: readonly PlannedSuggestion[]): Overlap | null {
  const ordered = [...planned].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.start - b.start || a.end - b.end));
  for (let i = 1; i < ordered.length; i++) {
    const before = ordered[i - 1];
    const current = ordered[i];
    if (before === undefined || current === undefined || before.path !== current.path) continue;
    if (current.start <= before.end) return { path: current.path, start: before.start, end: Math.max(before.end, current.end) };
  }
  return null;
}

function splitText(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Applies non-overlapping suggestions to a file's text, last region first so earlier numbers stay valid.
 *  Returns null when a region lies outside the file. */
export function applySuggestions(text: string, planned: readonly PlannedSuggestion[]): string | null {
  const lines = splitText(text);
  const ordered = [...planned].sort((a, b) => b.start - a.start);
  for (const suggestion of ordered) {
    if (suggestion.start < 1 || suggestion.end < suggestion.start || suggestion.end > lines.length) return null;
    lines.splice(suggestion.start - 1, suggestion.end - suggestion.start + 1, ...suggestion.lines);
  }
  if (lines.length === 0) return "";
  return `${lines.join("\n")}${text.endsWith("\n") ? "\n" : ""}`;
}

export function applyMessage(suggestions: number, files: number, firstPath: string): string {
  return suggestions === 1 ? `Apply suggestion to ${firstPath}` : `Apply ${suggestions} suggestions to ${files} files`;
}
