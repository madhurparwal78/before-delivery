import { createHash } from 'node:crypto';
import { Solid, solidJson } from './solid';

/** The geometry digest: the lowercase hex SHA-256 of the solid's canonical JSON bytes. */
export function geometryDigest(solid: Solid): string {
  return sha256Hex(Buffer.from(solidJson(solid), 'utf8'));
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
