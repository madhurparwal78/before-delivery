import { ATTACHMENT_TYPES } from '../shared/attachments.ts';
import { CONTROL_CHARACTERS } from '../shared/text.ts';

const SIGNATURES: Record<(typeof ATTACHMENT_TYPES)[number], number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** The attachment content check: the declared type must be one of the three and the bytes must start with its signature. */
export function contentMatchesType(contentType: string, bytes: Buffer): boolean {
  const signature = (SIGNATURES as Partial<Record<string, number[]>>)[contentType];
  return signature !== undefined && signature.every((byte, index) => bytes[index] === byte);
}

export function filenameProblem(name: string): string | null {
  const length = [...name].length;
  if (length < 1 || length > 200 || CONTROL_CHARACTERS.test(name)) return 'This file name cannot be stored.';
  return null;
}

const KEEP = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/** The Content-Disposition of a download: the plain form for printable ASCII, otherwise a fallback plus the UTF-8 form. */
export function downloadDisposition(name: string): string {
  if (/^[ -~]*$/.test(name) && !name.includes('"') && !name.includes('\\')) return `attachment; filename="${name}"`;
  const fallback = [...name].map((char) => (char.charCodeAt(0) > 126 || char === '"' || char === '\\' ? '_' : char)).join('');
  const encoded = [...Buffer.from(name, 'utf8')]
    .map((byte) => (KEEP.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`))
    .join('');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
