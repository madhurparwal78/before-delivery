export type AttachmentType = 'application/pdf' | 'image/jpeg' | 'image/png';

const SIGNATURES: Record<AttachmentType, Buffer> = {
  'application/pdf': Buffer.from('%PDF-', 'latin1'),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

export function isAttachmentType(contentType: string): contentType is AttachmentType {
  return contentType in SIGNATURES;
}

/** The one place that decides whether uploaded bytes match their declared type. */
export function bytesMatchDeclaredType(contentType: string, bytes: Buffer): boolean {
  if (!isAttachmentType(contentType)) return false;
  const signature = SIGNATURES[contentType];
  return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function isControlCharacter(codePoint: number): boolean {
  return codePoint <= 31 || codePoint === 127;
}

export function isStorableFilename(filename: string): boolean {
  const points = [...filename];
  if (points.length < 1 || points.length > 200) return false;
  return !points.some((character) => isControlCharacter(character.codePointAt(0) ?? 0));
}

const UNRESERVED = new Set("!#$&+-.^_`|~".split(''));

function isPlainAscii(filename: string): boolean {
  return [...filename].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code <= 126 && character !== '"' && character !== '\\';
  });
}

/** The one place that builds an attachment download's Content-Disposition header. */
export function contentDisposition(filename: string): string {
  if (isPlainAscii(filename)) return `attachment; filename="${filename}"`;
  const fallback = [...filename]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code > 127 || character === '"' || character === '\\') return '_';
      return character;
    })
    .join('');
  const encoded = [...Buffer.from(filename, 'utf8')]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      const isAlphanumeric = /[A-Za-z0-9]/.test(character);
      if (isAlphanumeric || UNRESERVED.has(character)) return character;
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
