const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** User-perceived characters: a family emoji or a flag counts as one. */
export function graphemeCount(value: string): number {
  let count = 0;
  for (const _segment of segmenter.segment(value)) count += 1;
  return count;
}

/**
 * A shopper's name as stored: trimmed, with each run of line breaks and its surrounding spaces
 * collapsed to one space, so a name can never add a mail header.
 */
export function normaliseMailName(value: string): string {
  return value.replace(/[^\S\r\n]*[\r\n]+[^\S\r\n]*/g, ' ').trim();
}

export function isEmailShaped(value: string): boolean {
  return /^[^\s@,;:<>"'\\]+@[^\s@,;:<>"'\\]+\.[^\s@,;:<>"'\\]+$/.test(value) && value.length <= 254;
}

/** Escapes a value for a CSV cell, neutralising anything a spreadsheet would read as a formula. */
export function csvCell(value: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(neutralised) ? `"${neutralised.replace(/"/g, '""')}"` : neutralised;
}

/** Comma-separated UTF-8 without a byte-order mark and with CRLF line ends. */
export function csvDocument(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
