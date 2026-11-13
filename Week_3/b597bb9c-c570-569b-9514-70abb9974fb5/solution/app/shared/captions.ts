import { codePoints } from "./codepoints";
import { CUE_LINES_MAX, CUE_LINE_MAX } from "./limits";

export function cueLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Code points left on the cue's longest line (negative when over the limit). */
export function charactersLeft(text: string): number {
  return CUE_LINE_MAX - Math.max(...cueLines(text).map(codePoints));
}

/** One or two non-empty lines of at most 42 code points, not only whitespace. */
export function validCueText(text: string): boolean {
  const lines = cueLines(text);
  return (
    text.trim().length > 0 &&
    lines.length <= CUE_LINES_MAX &&
    lines.every((line) => line.length > 0 && codePoints(line) <= CUE_LINE_MAX)
  );
}
