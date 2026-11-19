const encoder = new TextEncoder();

export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorts paths by their UTF-8 bytes. */
export function byteOrder(paths: string[]): string[] {
  return [...paths].sort(byteCompare);
}

export function isHex12(id: string): boolean {
  return /^[0-9a-f]{12}$/.test(id);
}

export function decodeBase64(s: string): string {
  return Buffer.from(s, 'base64').toString('utf8');
}

export function isValidBase64Utf8(s: string): boolean {
  const bytes = Buffer.from(s, 'base64');
  const stripped = Buffer.from(bytes).subarray(0, bytes.length);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(stripped);
    return true;
  } catch {
    return false;
  }
}
