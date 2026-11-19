const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

/** Paths and names sort and compare by their UTF-8 bytes. */
export const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

export function validPath(path: string): boolean {
  const bytes = byteLength(path);
  if (bytes < 1 || bytes > 255 || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export const validBranch = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
export const validUsername = (name: string): boolean => /^[a-z][a-z0-9-]{1,31}$/.test(name);
export const validSlug = (name: string): boolean => /^[a-z0-9][a-z0-9-]{0,38}$/.test(name);
export const validRevisionId = (id: string): boolean => /^[0-9a-f]{12}$/.test(id);

/** A UTF-8 decode that refuses invalid bytes (the push route takes text only). */
export function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}
