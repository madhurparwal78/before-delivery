import { getObject, headObject, putObject } from './s3.js';
import type { Variant } from './images.js';

export type Slot = 'original' | '320' | '640' | '1080';

export const SLOTS: Slot[] = ['original', '320', '640', '1080'];

export function objectKey(sha256: string, slot: Slot): string {
  return `images/${sha256}/${slot}.webp`;
}

/** Writes every variant, then confirms each stored object with a HEAD request. */
export async function storeVariants(sha256: string, variants: Variant[]): Promise<boolean> {
  for (const variant of variants) {
    await putObject(objectKey(sha256, variant.slot), variant.bytes, 'image/webp');
  }
  return confirmVariants(sha256);
}

export async function confirmVariants(sha256: string): Promise<boolean> {
  for (const slot of SLOTS) {
    if (!(await headObject(objectKey(sha256, slot)))) return false;
  }
  return true;
}

export async function readVariant(sha256: string, slot: Slot): Promise<Buffer | null> {
  return getObject(objectKey(sha256, slot));
}
