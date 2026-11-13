const startsWith = (bytes: Buffer, signature: number[]): boolean =>
  bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

const isPlainUtf8 = (bytes: Buffer): boolean => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/** The stored content type, judged by the leading bytes only. */
export const detectContentType = (bytes: Buffer): string | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytes.slice(0, 6).toString('latin1') === 'GIF87a' || bytes.slice(0, 6).toString('latin1') === 'GIF89a') {
    return 'image/gif';
  }
  if (bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (bytes.length > 0 && isPlainUtf8(bytes)) return 'text/plain; charset=utf-8';
  return null;
};

export const isImageType = (contentType: string): boolean => contentType.startsWith('image/');

export const storedFileName = (given: string): string => {
  const base = given.split(/[\\/]/).pop() ?? '';
  const cleaned = Array.from(base)
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
    .join('')
    .slice(0, 120);
  return cleaned === '' ? 'file' : cleaned;
};
