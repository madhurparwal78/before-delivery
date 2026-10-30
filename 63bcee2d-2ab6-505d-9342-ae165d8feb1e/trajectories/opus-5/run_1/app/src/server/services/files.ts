/** File kinds judged by content signature, never by name or declared type. */

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'svg';

export const FILE_LIMIT_BYTES = 10_000_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const CONTENT_TYPES: Record<FileKind, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
};

export const EXTENSIONS: Record<FileKind, string> = {
  pdf: 'pdf',
  png: 'png',
  jpeg: 'jpg',
  svg: 'svg',
};

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** True when the text's first element, after the allowed prologue, is `svg`. */
function startsWithSvgElement(text: string): boolean {
  let rest = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>');
      if (end === -1) return false;
      rest = rest.slice(end + 2);
      continue;
    }
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      if (end === -1) return false;
      rest = rest.slice(end + 3);
      continue;
    }
    if (/^<!DOCTYPE/i.test(rest)) {
      const end = rest.indexOf('>');
      if (end === -1) return false;
      rest = rest.slice(end + 1);
      continue;
    }
    break;
  }
  return /^<svg(\s|\/|>)/i.test(rest);
}

export function detectFileKind(bytes: Buffer): FileKind | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  const text = decodeUtf8(bytes);
  if (text !== null && startsWithSvgElement(text)) return 'svg';
  return null;
}

/** An SVG with a script element, an on* attribute or a javascript: URL. */
export function svgCarriesScript(bytes: Buffer): boolean {
  const text = bytes.toString('utf8');
  if (/<\s*script[\s>/]/i.test(text)) return true;
  if (/[\s"'/]on[a-zA-Z0-9_:-]*\s*=/i.test(text)) return true;
  if (/javascript\s*:/i.test(text)) return true;
  return false;
}

/** The original file name kept for display, with any folder parts removed. */
export function baseFileName(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] ?? name;
}

/** A sheet code taken from a file name: the stem, in capital letters. */
export function sheetCodeFromFileName(name: string): string {
  const base = baseFileName(name);
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).toUpperCase();
}
