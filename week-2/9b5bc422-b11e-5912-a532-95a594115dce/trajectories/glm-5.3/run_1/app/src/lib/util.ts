import type { BlockType } from '../../shared/domain';

// Ids created by the device.
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function blockName(type: BlockType, label: string, notSynced: boolean, bothKept: boolean): string {
  const typeLabel = TYPE_LABELS[type];
  let name = label ? `${typeLabel}: ${label}` : typeLabel;
  if (notSynced) name += ', not yet synced';
  if (bothKept) name += ', Both kept';
  return name;
}

export const TYPE_LABELS: Record<BlockType, string> = {
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulleted: 'Bulleted list',
  numbered: 'Numbered list',
  todo: 'To-do',
  quote: 'Quote',
  divider: 'Divider',
  image: 'Image',
  file: 'File',
  table: 'Record table',
};

export function firstChars(text: string, n = 40): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.slice(0, n);
}

export function longDate(d: Date): string {
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${weekdays[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

export function formatNumber(n: number): string {
  return n.toFixed(2);
}

export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100) / 100;
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);
}

export const MOD = isMac() ? '\u2318' : 'Ctrl';

// Number formatting for column totals: two decimals, no separators.
export function totalText(sum: number): string {
  return sum.toFixed(2);
}

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const FORMULA_CHARS = ['=', '+', '-', '@'];

// A cell that could run as a formula gets one extra leading apostrophe.
export function csvNeutralise(value: string): string {
  if (value === '') return value;
  const m = /^('+)([=+\-@])(.*)$/s.exec(value);
  if (m) return `'${value}`;
  if (FORMULA_CHARS.includes(value[0])) return `'${value}`;
  return value;
}

export function csvRestore(value: string): string {
  if (value === '') return value;
  const m = /^('+)([=+\-@])(.*)$/s.exec(value);
  if (m) return value.slice(1);
  return value;
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
