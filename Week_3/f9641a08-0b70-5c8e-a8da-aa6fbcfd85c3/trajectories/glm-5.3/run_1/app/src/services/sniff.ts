/** Upload content-type sniffing: decided by the file's first bytes only. */

export type SniffResult = { type: 'jpeg' | 'png' | 'webp' | 'pdf' | null; content_type: string | null };

export function sniff(bytes: Buffer): SniffResult {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: 'jpeg', content_type: 'image/jpeg' };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'png', content_type: 'image/png' };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { type: 'webp', content_type: 'image/webp' };
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { type: 'pdf', content_type: 'application/pdf' };
  }
  return { type: null, content_type: null };
}

/** A PDF carrying JavaScript or embedded files is refused. */
export function pdfIsSafe(bytes: Buffer): boolean {
  const text = bytes.toString('latin1');
  if (/\/JavaScript/.test(text)) return false;
  if (/\/JS\b/.test(text)) return false;
  if (/\/EmbeddedFile/.test(text)) return false;
  if (/\/Launch/.test(text)) return false;
  if (/\/OpenAction/.test(text)) return false;
  return true;
}

/** Drops folder parts and control characters, keeps at most 120 characters. */
export function cleanFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned.slice(0, 120);
}
