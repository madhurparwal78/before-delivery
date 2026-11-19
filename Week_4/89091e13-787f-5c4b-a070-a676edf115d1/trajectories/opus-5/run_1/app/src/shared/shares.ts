import { fromHex, toHex } from './hex.js';
import { NAMESPACE_BYTES, PADDING_NAMESPACE } from './namespace.js';

export const SHARE_SIZE = 64;
export const FIRST_SHARE_DATA_BYTES = 50;
export const CONTINUATION_SHARE_DATA_BYTES = 54;
const INFO_BYTE_OFFSET = NAMESPACE_BYTES;
const SEQUENCE_LENGTH_OFFSET = 10;
const FIRST_SHARE_DATA_OFFSET = 14;
const CONTINUATION_DATA_OFFSET = 10;

/** Shares a blob of n bytes occupies. */
export function shareCount(size: number): number {
  if (size <= FIRST_SHARE_DATA_BYTES) return 1;
  return 1 + Math.ceil((size - FIRST_SHARE_DATA_BYTES) / CONTINUATION_SHARE_DATA_BYTES);
}

/** The largest blob a square of the given width can carry. */
export function maxBlobBytes(maxSquareWidth: number): number {
  return FIRST_SHARE_DATA_BYTES + CONTINUATION_SHARE_DATA_BYTES * (maxSquareWidth * maxSquareWidth - 1);
}

export function infoByte(isFirstShare: boolean): number {
  return 0 * 2 + (isFirstShare ? 1 : 0);
}

/** Splits a blob payload into the published 64-byte shares. */
export function blobToShares(namespaceHex: string, data: Uint8Array): Uint8Array[] {
  const namespace = fromHex(namespaceHex);
  const shares: Uint8Array[] = [];
  let offset = 0;
  let first = true;
  do {
    const share = new Uint8Array(SHARE_SIZE);
    share.set(namespace, 0);
    share[INFO_BYTE_OFFSET] = infoByte(first);
    let dataOffset: number;
    let capacity: number;
    if (first) {
      new DataView(share.buffer).setUint32(SEQUENCE_LENGTH_OFFSET, data.length);
      dataOffset = FIRST_SHARE_DATA_OFFSET;
      capacity = FIRST_SHARE_DATA_BYTES;
    } else {
      dataOffset = CONTINUATION_DATA_OFFSET;
      capacity = CONTINUATION_SHARE_DATA_BYTES;
    }
    const chunk = data.subarray(offset, offset + capacity);
    share.set(chunk, dataOffset);
    shares.push(share);
    offset += capacity;
    first = false;
  } while (offset < data.length);
  return shares;
}

export function paddingShare(): Uint8Array {
  const share = new Uint8Array(SHARE_SIZE);
  share.set(fromHex(PADDING_NAMESPACE), 0);
  share[INFO_BYTE_OFFSET] = infoByte(true);
  return share;
}

export function shareNamespaceHex(share: Uint8Array): string {
  return toHex(share.subarray(0, NAMESPACE_BYTES));
}

export interface ShareFields {
  namespace: string;
  infoByte: string;
  isFirstShare: boolean;
  sequenceLength: number | null;
  data: string;
}

/** Reads a share back into its published fields for the share panel. */
export function readShare(share: Uint8Array): ShareFields {
  const info = share[INFO_BYTE_OFFSET];
  const isFirstShare = (info & 1) === 1;
  const sequenceLength = isFirstShare
    ? new DataView(share.buffer, share.byteOffset, share.byteLength).getUint32(SEQUENCE_LENGTH_OFFSET)
    : null;
  const dataOffset = isFirstShare ? FIRST_SHARE_DATA_OFFSET : CONTINUATION_DATA_OFFSET;
  return {
    namespace: shareNamespaceHex(share),
    infoByte: toHex(share.subarray(INFO_BYTE_OFFSET, INFO_BYTE_OFFSET + 1)),
    isFirstShare,
    sequenceLength,
    data: toHex(share.subarray(dataOffset)),
  };
}
