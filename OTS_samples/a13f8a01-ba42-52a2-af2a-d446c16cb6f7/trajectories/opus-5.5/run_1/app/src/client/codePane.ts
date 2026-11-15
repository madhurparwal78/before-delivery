const indentUnit = "  ";

export function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function touchedLines(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const to = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const lineEnd = value.indexOf("\n", to);
  return { from, to: lineEnd === -1 ? value.length : lineEnd };
}

export function indent(area: HTMLTextAreaElement): void {
  const { selectionStart: start, selectionEnd: end, value } = area;
  if (start === end) {
    area.setRangeText(indentUnit, start, end, "end");
    return;
  }
  const { from, to } = touchedLines(value, start, end);
  const lines = value.slice(from, to).split("\n");
  area.setRangeText(lines.map((line) => indentUnit + line).join("\n"), from, to, "preserve");
  area.setSelectionRange(start + indentUnit.length, end + indentUnit.length * lines.length);
}

export function outdent(area: HTMLTextAreaElement): void {
  const { selectionStart: start, selectionEnd: end, value } = area;
  const { from, to } = touchedLines(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const removed = lines.map((line) => /^ {0,2}/.exec(line)?.[0].length ?? 0);
  area.setRangeText(lines.map((line, index) => line.slice(removed[index])).join("\n"), from, to, "preserve");
  const firstRemoved = Math.min(removed[0] ?? 0, start - from);
  const totalRemoved = removed.reduce((sum, count) => sum + count, 0);
  area.setSelectionRange(Math.max(from, start - firstRemoved), Math.max(from, end - totalRemoved));
}
