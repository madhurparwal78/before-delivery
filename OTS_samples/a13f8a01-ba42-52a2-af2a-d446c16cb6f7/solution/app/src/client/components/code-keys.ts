const INDENT = "  ";

interface TabEdit {
  from: number;
  to: number;
  text: string;
  selection: [number, number];
}

function lineStart(value: string, at: number): number {
  return value.lastIndexOf("\n", at - 1) + 1;
}

function lineEnd(value: string, at: number): number {
  const found = value.indexOf("\n", at);
  return found < 0 ? value.length : found;
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (count < INDENT.length && line[count] === " ") count++;
  return count;
}

export function tabEdit(value: string, start: number, end: number, outdent: boolean): TabEdit {
  if (!outdent && start === end) {
    return { from: start, to: end, text: INDENT, selection: [start + INDENT.length, start + INDENT.length] };
  }
  const lastTouched = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const from = lineStart(value, start);
  const lines = value.slice(from, lineEnd(value, lastTouched)).split("\n");
  const removed = lines.map(leadingSpaces);
  const deltas = removed.map((count) => (outdent ? -count : INDENT.length));
  const text = lines.map((line, index) => (outdent ? line.slice(removed[index] ?? 0) : INDENT + line)).join("\n");
  const selectionStart = start === from ? start : Math.max(from, start + (deltas[0] ?? 0));
  const selectionEnd = start === end ? selectionStart : Math.max(selectionStart, end + deltas.reduce((sum, delta) => sum + delta, 0));
  return { from, to: from + value.slice(from, lineEnd(value, lastTouched)).length, text, selection: [selectionStart, selectionEnd] };
}
