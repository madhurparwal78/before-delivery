export interface ImportRow {
  line: number;
  styleNumber: string;
  name: string;
  colour: string;
  wholesaleEdition: number | null;
  rrpDkkMinor: number | null;
  invalidField: string | null;
}

export interface ParsedImport {
  rows: ImportRow[];
  headerOk: boolean;
}

const EXPECTED_HEADERS = ['style no', 'name', 'colour', 'edition', 'rrp dkk'];

/** Amounts use decimal commas and dot thousands separators, so `2.799,00` is DKK 2,799.00. */
export function parseLegacyAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.replace(/\./g, '').split(',');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
}

/** Editions are whole numbers that may use dot thousands separators. */
export function parseLegacyEdition(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(/\./g, ''));
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : null;
}

/**
 * Reads the previous tool's line sheet: UTF-8 with an optional byte-order mark,
 * semicolon-separated, with headers matched ignoring case and surrounding spaces. Line numbers
 * count from the header as line 1.
 */
export function parseLegacyLineSheet(bytes: Buffer): ParsedImport {
  let content = bytes.toString('utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split(/\r\n|\n|\r/);
  const headerLine = lines[0] ?? '';
  const headers = headerLine.split(';').map((cell) => cell.trim().toLowerCase());
  const headerOk = EXPECTED_HEADERS.every((expected, index) => headers[index] === expected);
  if (!headerOk) return { rows: [], headerOk: false };

  const rows: ImportRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index] as string;
    if (raw.trim() === '') continue;
    const cells = raw.split(';');
    const styleNumber = (cells[0] ?? '').trim();
    const name = (cells[1] ?? '').trim();
    const colour = (cells[2] ?? '').trim();
    const editionCell = cells[3] ?? '';
    const rrpCell = cells[4] ?? '';
    const wholesaleEdition = parseLegacyEdition(editionCell);
    const rrpDkkMinor = parseLegacyAmount(rrpCell);
    const invalidField =
      wholesaleEdition === null ? 'Edition' : rrpDkkMinor === null ? 'RRP DKK' : null;
    rows.push({
      line: index + 1,
      styleNumber,
      name,
      colour,
      wholesaleEdition,
      rrpDkkMinor,
      invalidField,
    });
  }
  return { rows, headerOk: true };
}

export function matchKey(styleNumber: string): string {
  return styleNumber.trim().toUpperCase();
}
