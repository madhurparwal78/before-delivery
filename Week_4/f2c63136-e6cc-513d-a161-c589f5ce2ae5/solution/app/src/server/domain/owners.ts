import { byteOrder } from './validate.ts';

interface OwnerLine {
  pattern: string;
  owners: string[];
}

export function parseOwners(text: string): OwnerLine[] {
  const lines: OwnerLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    lines.push({ pattern, owners: owners.filter((owner) => owner.startsWith('@')).map((owner) => owner.slice(1)) });
  }
  return lines;
}

function segmentMatches(pattern: string, segment: string): boolean {
  const expression = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${expression}$`).test(segment);
}

/** Whole-segment matching with `**` standing for any number of whole segments. */
function segmentsMatch(pattern: string[], path: string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const [head, ...rest] = pattern;
  if (head === '**') {
    const minimum = rest.length === 0 ? 1 : 0;
    for (let skip = minimum; skip <= path.length; skip += 1) {
      if (segmentsMatch(rest, path.slice(skip))) return true;
    }
    return false;
  }
  return path.length > 0 && segmentMatches(head, path[0]) && segmentsMatch(rest, path.slice(1));
}

function patternMatches(patternText: string, filePath: string): boolean {
  const directoryOnly = patternText.endsWith('/');
  let pattern = directoryOnly ? patternText.slice(0, -1) : patternText;
  const rooted = pattern.startsWith('/');
  if (rooted) pattern = pattern.slice(1);
  const segments = pattern.split('/');
  const path = filePath.split('/');
  const floating = !rooted && segments.length === 1;
  if (directoryOnly) {
    const starts = floating ? path.length - 1 : 1;
    for (let offset = 0; offset < starts; offset += 1) {
      for (let take = 1; offset + take < path.length; take += 1) {
        if (segmentsMatch(segments, path.slice(offset, offset + take))) return true;
      }
    }
    return false;
  }
  if (floating) return segmentMatches(segments[0], path[path.length - 1]);
  return segmentsMatch(segments, path);
}

/** The owners of a path: the last matching line wins, and a line with no owners makes it unowned. */
export function ownersOf(lines: OwnerLine[], filePath: string): string[] {
  let owners: string[] = [];
  for (const line of lines) if (patternMatches(line.pattern, filePath)) owners = line.owners;
  return owners;
}

export const sortPaths = (paths: string[]): string[] => [...paths].sort(byteOrder);
