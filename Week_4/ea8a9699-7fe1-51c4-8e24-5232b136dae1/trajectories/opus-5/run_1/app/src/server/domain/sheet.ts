import type { ClusterEntry } from '../../shared/types.js';

const riskyLeadingCharacters = ['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠'];

/** The one place that neutralises a cluster sheet cell that a spreadsheet would read as a formula. */
function neutralise(value: string): string {
  const first = Array.from(value)[0];
  return first !== undefined && riskyLeadingCharacters.includes(first) ? `'${value}` : value;
}

function quote(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function textCell(value: string): string {
  return quote(neutralise(value));
}

function plainCell(value: string): string {
  return quote(value);
}

export function clusterSheet(entries: readonly ClusterEntry[]): string {
  const lines = ['position,title,kind,source_clip,timecode,private'];
  for (const entry of entries) {
    lines.push(
      [
        String(entry.position),
        textCell(entry.reference.title),
        entry.reference.kind,
        textCell(entry.reference.sourceClipTitle ?? ''),
        plainCell(entry.reference.timecode ?? ''),
        entry.isPrivate ? 'yes' : 'no',
      ].join(','),
    );
  }
  return lines.map((line) => `${line}\r\n`).join('');
}
