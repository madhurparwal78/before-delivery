// Evidence content checks. An accepted file is stored exactly as submitted and
// its SHA-256 is computed over the submitted bytes.

import { createHash } from 'node:crypto';


export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export type ImageKind = 'jpeg' | 'png' | 'webp';

export function signatureMatches(bytes: Uint8Array, kind: string): boolean {
  if (kind === 'jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (kind === 'png') {
    const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
    for (let i = 0; i < head.length; i++) {
      if (bytes[i] !== head[i]) return false;
    }
    return true;
  }
  // WebP: "RIFF", any four bytes, then "WEBP".
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  if (riff !== 'RIFF') return false;
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  return webp === 'WEBP';
}
