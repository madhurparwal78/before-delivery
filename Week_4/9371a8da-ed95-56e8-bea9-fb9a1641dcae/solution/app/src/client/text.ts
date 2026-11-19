// A text field shows every line break as LF; stored text keeps its own bytes.
// These helpers convert between stored UTF-16 offsets and text-field offsets.

export function toView(stored: string): string {
  return stored.replace(/\r\n?/g, "\n");
}

/** View indexes of every stored CRLF (the position of its line break in the view). */
function crlfViewIndexes(stored: string): number[] {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = stored.indexOf("\r\n", from);
    if (at < 0) return found;
    found.push(at - found.length);
    from = at + 2;
  }
}

interface OffsetMap {
  toStored(view: number): number;
  toView(stored: number): number;
}

export function offsetMap(stored: string): OffsetMap {
  const breaks = crlfViewIndexes(stored);
  return {
    toStored(view) {
      let extra = 0;
      while (extra < breaks.length && (breaks[extra] as number) < view) extra += 1;
      return view + extra;
    },
    toView(position) {
      let extra = 0;
      while (extra < breaks.length && (breaks[extra] as number) + extra + 1 < position) extra += 1;
      return position - extra;
    },
  };
}

/** The style of the file's first line break, or LF when it has none yet. */
export function lineBreakOf(stored: string): string {
  const at = stored.indexOf("\n");
  return at > 0 && stored[at - 1] === "\r" ? "\r\n" : "\n";
}

export function lineOf(view: string, offset: number): number {
  let line = 1;
  let at = view.indexOf("\n");
  while (at >= 0 && at < offset) {
    line += 1;
    at = view.indexOf("\n", at + 1);
  }
  return line;
}

/** `line`, or the last line when the text has fewer, counted the way the text field counts them. */
export function lastLineAtMost(view: string, line: number): number {
  return Math.min(line, view.split("\n").length);
}

export function lineStart(view: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const at = view.indexOf("\n", offset);
    if (at < 0) return view.length;
    offset = at + 1;
  }
  return offset;
}

/** Only used to pick which field copy to show for a refusal the server already made. */
export function looksUnstorable(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
