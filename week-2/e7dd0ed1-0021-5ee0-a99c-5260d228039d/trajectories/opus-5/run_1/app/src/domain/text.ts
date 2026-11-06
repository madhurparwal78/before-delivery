const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Limits given in characters count user-perceived characters (grapheme clusters). */
export function countCharacters(value: string): number {
  let count = 0;
  for (const _ of segmenter.segment(value)) count += 1;
  return count;
}

export function characters(value: string): string[] {
  return Array.from(segmenter.segment(value), (part) => part.segment);
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** CSV neutralisation and RFC 4180 quoting, used by both exports. */
export function csvField(value: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(neutralised)) return `"${neutralised.replace(/"/g, '""')}"`;
  return neutralised;
}

export function csvLine(fields: string[]): string {
  return `${fields.map(csvField).join(',')}\n`;
}
