/**
 * The message-text link rule (DP-64), decided in this one place.
 * Input is the raw stored text; output is segments a renderer joins.
 */
export type TextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string }
  | { kind: 'br' };

export function parseMessageText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const lines = text.split('\n');
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) segments.push({ kind: 'br' });
    let i = 0;
    while (i < line.length) {
      const match = findLinkStart(line, i);
      if (!match) {
        segments.push({ kind: 'text', value: line.slice(i) });
        break;
      }
      if (match.start > i) segments.push({ kind: 'text', value: line.slice(i, match.start) });
      segments.push({ kind: 'link', value: match.run, href: match.run });
      i = match.start + match.run.length;
    }
  });
  return segments;
}

interface LinkMatch {
  start: number;
  run: string;
}

const SCHEME_RE = /^https?:\/\//i;

/** Tests whether position i can start a link run, per the boundary rules. */
function findLinkStart(line: string, from: number): LinkMatch | null {
  for (let i = from; i < line.length; i++) {
    const before = i === 0 ? '' : line[i - 1];
    if (before && /[a-zA-Z0-9]/.test(before)) continue;
    const rest = line.slice(i);
    if (!SCHEME_RE.test(rest)) continue;
    let end = rest.search(/[\s<>"]/);
    if (end === -1) end = rest.length;
    let run = rest.slice(0, end);
    run = trimTrailing(run);
    if (run.length <= 0) continue;
    if (SCHEME_RE.test(run) && run.replace(SCHEME_RE, '').length === 0) continue;
    return { start: i, run };
  }
  return null;
}

function trimTrailing(run: string): string {
  let out = run;
  for (;;) {
    const last = out[out.length - 1];
    if (last === '.' || last === ',' || last === ';' || last === ':' || last === '!' || last === '?') {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
    }
    return out;
  }
}

/** True when the run has nothing after the scheme (e.g. `http://`). */
export function isEmptyLinkRun(run: string): boolean {
  return run.replace(SCHEME_RE, '').length === 0;
}
