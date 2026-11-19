/**
 * The one message-text link rule.
 *
 * Message text is plain text everywhere. Only a run starting `http://` or
 * `https://` becomes a link; every other scheme, bare `www.` and Markdown link
 * syntax stay literal.
 */

export type TextSegment = { kind: 'text'; value: string } | { kind: 'link'; value: string; href: string };

const SCHEMES = ['http://', 'https://'];
const TRAILING = new Set(['.', ',', ';', ':', '!', '?']);

function isAlphanumeric(character: string | undefined): boolean {
  if (character === undefined) return false;
  return /[A-Za-z0-9]/.test(character);
}

function schemeAt(text: string, index: number): string | null {
  const ahead = text.slice(index, index + 8).toLowerCase();
  for (const scheme of SCHEMES) {
    if (ahead.startsWith(scheme)) return scheme;
  }
  return null;
}

function trimRun(run: string): string {
  let result = run;
  for (;;) {
    const last = result.slice(-1);
    if (TRAILING.has(last)) {
      result = result.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (result.match(/\(/g) ?? []).length;
      const closes = (result.match(/\)/g) ?? []).length;
      if (closes > opens) {
        result = result.slice(0, -1);
        continue;
      }
    }
    return result;
  }
}

export function splitMessageText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    const scheme = schemeAt(text, index);
    const boundaryOk = index === 0 || !isAlphanumeric(text[index - 1]);
    if (scheme === null || !boundaryOk) {
      plain += text[index];
      index += 1;
      continue;
    }
    let end = index;
    while (end < text.length) {
      const character = text[end] as string;
      if (/\s/.test(character) || character === '<' || character === '>' || character === '"') break;
      end += 1;
    }
    const run = text.slice(index, end);
    const kept = trimRun(run);
    const afterScheme = kept.slice(kept.toLowerCase().indexOf('://') + 3);
    if (kept.length <= scheme.length || afterScheme.length === 0) {
      plain += text.slice(index, end);
      index = end;
      continue;
    }
    if (plain.length > 0) {
      segments.push({ kind: 'text', value: plain });
      plain = '';
    }
    segments.push({ kind: 'link', value: kept, href: kept });
    plain += run.slice(kept.length);
    index = end;
  }
  if (plain.length > 0) segments.push({ kind: 'text', value: plain });
  return segments;
}
