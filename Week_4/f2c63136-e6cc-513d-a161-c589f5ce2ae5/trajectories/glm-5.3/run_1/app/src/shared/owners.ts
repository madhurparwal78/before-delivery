/**
 * The owners file: `.review/OWNERS` lines of `<pattern> <owner> ...`. Last
 * matching line wins; a matching line with no owners makes the path unowned.
 */
export interface OwnersLine { pattern: string; owners: string[] }

export function parseOwners(text: string): OwnersLine[] {
  const lines: OwnersLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const trimmed = line.trim();
    const spaceAt = trimmed.indexOf(' ');
    const pattern = spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt);
    const rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1);
    const owners = rest.trim() === '' ? [] : rest.trim().split(/\s+/);
    lines.push({ pattern, owners });
  }
  return lines;
}

export function splitSegments(path: string): string[] {
  return path.split('/');
}

function patternSegments(pattern: string): { segments: string[]; trailingSlash: boolean } {
  const trailingSlash = pattern.endsWith('/');
  const body = trailingSlash ? pattern.slice(0, -1) : pattern;
  return { segments: body.split('/'), trailingSlash };
}

function segmentMatches(patternSeg: string, seg: string): boolean {
  // `*` matches any characters within one segment (including none)
  const star = patternSeg.indexOf('*');
  if (star === -1) return patternSeg === seg;
  const parts = patternSeg.split('*');
  let pos = 0;
  if (!startsWith(seg, parts[0], 0)) return false;
  pos = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] === '') continue;
    const found = seg.indexOf(parts[i], pos);
    if (found < 0) return false;
    pos = found + parts[i].length;
  }
  return pos === seg.length || endsWithTail(seg, parts[parts.length - 1], pos);
}

function startsWith(s: string, prefix: string, pos: number): boolean {
  return s.startsWith(prefix, pos);
}

function endsWithTail(s: string, tail: string, pos: number): boolean {
  if (tail === '') return pos <= s.length;
  return s.length - tail.length >= pos && s.endsWith(tail);
}

function endsWithSeg(s: string, prefix: string): boolean {
  return s.startsWith(prefix) && prefix.endsWith('*') && s.length >= prefix.length - 1;
}

/** Does one pattern match one path, per the published glob rules. */
export function patternMatches(pattern: string, path: string): boolean {
  const hasSlash = pattern.includes('/');
  if (!hasSlash) {
    // file-name pattern at any depth
    const name = splitSegments(path).pop() as string;
    return segmentMatches(pattern, name);
  }
  const trailingFolder = pattern.endsWith('/');
  const body = trailingFolder ? pattern.slice(0, -1) : pattern;
  const effective = pattern.startsWith('/') ? patternSegments(body).segments.slice(1) : patternSegments(body).segments;
  return matchFrom(effective, splitSegments(path), 0, 0, trailingFolder);
}

function matchFrom(pat: string[], segs: string[], pi: number, si: number, trailingFolder: boolean): boolean {
  if (pi >= pat.length) return trailingFolder ? si < segs.length : si === segs.length;
  const cur = pat[pi];
  if (cur === '**') {
    // matches any number of whole segments; at least one when it is the last
    if (pi === pat.length - 1) {
      return segs.length - si >= 1;
    }
    for (let k = si; k <= segs.length; k++) {
      if (matchFrom(pat, segs, pi + 1, k, trailingFolder)) return true;
    }
    return false;
  }
  if (si >= segs.length) return false;
  if (!segmentMatches(cur, segs[si])) return false;
  return matchFrom(pat, segs, pi + 1, si + 1, trailingFolder);
}

/** The owners of one path: the last matching line's owners. */
export function ownersFor(lines: OwnersLine[], path: string): string[] | null {
  let found: string[] | null = null;
  for (const line of lines) {
    if (patternMatches(line.pattern, path)) found = line.owners;
  }
  return found;
}
