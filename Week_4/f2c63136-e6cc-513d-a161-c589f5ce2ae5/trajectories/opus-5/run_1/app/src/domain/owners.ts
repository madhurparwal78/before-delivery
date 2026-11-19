export interface OwnersLine {
  pattern: string;
  owners: string[];
}

export const OWNERS_PATH = '.review/OWNERS';

export function parseOwners(text: string): OwnersLine[] {
  const lines: OwnersLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    lines.push({ pattern: parts[0], owners: parts.slice(1) });
  }
  return lines;
}

function escapeSegment(segment: string): string {
  let out = '';
  for (const character of segment) {
    if (character === '*') out += '[^/]*';
    else if ('\\^$.|?+()[]{}'.includes(character)) out += `\\${character}`;
    else out += character;
  }
  return out;
}

function patternRegex(pattern: string): RegExp {
  const endsWithSlash = pattern.endsWith('/');
  const trimmed = endsWithSlash ? pattern.slice(0, -1) : pattern;
  const anchored = trimmed.startsWith('/') || trimmed.includes('/');
  const body = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const segments = body.split('/');

  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '.+' : '(?:[^/]+/)*';
    } else {
      source += escapeSegment(segment) + (last ? '' : '/');
    }
  });
  if (endsWithSlash) source += '/.+';
  const prefix = anchored ? '' : '(?:.*/)?';
  return new RegExp(`^${prefix}${source}$`);
}

export function matchesPattern(pattern: string, path: string): boolean {
  return patternRegex(pattern).test(path);
}

/** The owners of a path come from the last matching line; a matching line with no owners makes it unowned. */
export function ownersForPath(lines: OwnersLine[], path: string): string[] {
  let owners: string[] = [];
  for (const line of lines) {
    if (matchesPattern(line.pattern, path)) owners = line.owners;
  }
  return owners;
}
