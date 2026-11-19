// Memo signatures: the body's leading bytes must match the declared type,
// compared case-insensitively and without parameters.

export const MEMO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'] as const;

export type MemoType = (typeof MEMO_TYPES)[number];

export function memoTypeOf(contentType: string): MemoType | null {
  const base = contentType.trim().split(';')[0]?.trim().toLowerCase() ?? '';
  return (MEMO_TYPES as readonly string[]).includes(base) ? (base as MemoType) : null;
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if ((bytes[i] ?? 0) !== sig[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if ((bytes[offset + i] ?? 0) !== text.charCodeAt(i)) return false;
  }
  return true;
}

export function signatureMatches(bytes: Uint8Array, type: MemoType): boolean {
  switch (type) {
    case 'audio/webm':
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'audio/ogg':
      return bytes.length >= 4 && ascii(bytes, 0, 'OggS');
    case 'audio/mp4':
      return bytes.length >= 8 && ascii(bytes, 4, 'ftyp');
    case 'audio/mpeg':
      if (bytes.length >= 3 && ascii(bytes, 0, 'ID3')) return true;
      if (bytes.length >= 2 && (bytes[0] ?? 0) === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return true;
      return false;
    case 'audio/wav':
      return bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE');
  }
}

export const MEMO_MAX_BYTES = 5_000_000;
export const JSON_MAX_BYTES = 64_000;
