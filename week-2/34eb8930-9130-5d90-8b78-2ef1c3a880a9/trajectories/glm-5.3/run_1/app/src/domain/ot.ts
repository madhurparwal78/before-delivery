export type MarkType = 'bold' | 'italic' | 'underline' | 'link';
export type BlockStyle = 'title' | 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered';

export type Op =
  | { insert: string; at: number }
  | { delete: number; at: number }
  | { mark: MarkType; value: boolean | string | null; at: number; length: number }
  | { style: BlockStyle; at: number };

export const MAX_DOCUMENT_CHARS = 200_000;
export const MAX_FRAME_BYTES = 65_536;
export const MAX_INSERT_CHARS = 10_000;

export function isWordChar(c: string): boolean {
  return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9';
}

/** A word is a run of letters or digits, so "$9,600" holds the words "9" and "600". */
export function wordStart(text: string, pos: number): number {
  let i = pos;
  while (i > 0 && isWordChar(text[i - 1]!)) i -= 1;
  return i;
}

export function wordEnd(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && isWordChar(text[i]!)) i += 1;
  return i;
}

/**
 * An anchored range whose offsets move with every edit made before them.
 * An offset that lies strictly inside a removed range collapses to its start.
 */
export function moveOffset(offset: number, from: number, cut: number, delta: number): number {
  if (offset <= from) return offset;
  if (offset >= from + cut) return offset + delta;
  return from;
}
