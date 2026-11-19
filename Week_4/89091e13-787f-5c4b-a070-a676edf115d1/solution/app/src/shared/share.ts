/** The 64-byte share format: namespace, info byte, then (first share only) the sequence length, then data. */
export const SHARE_SIZE = 64;
export const NAMESPACE_SIZE = 9;
export const INFO_BYTE_OFFSET = 9;
export const SEQUENCE_LENGTH_OFFSET = 10;
export const FIRST_SHARE_DATA_OFFSET = 14;
export const CONTINUATION_SHARE_DATA_OFFSET = 10;
export const FIRST_SHARE_DATA = SHARE_SIZE - FIRST_SHARE_DATA_OFFSET;
export const CONTINUATION_SHARE_DATA = SHARE_SIZE - CONTINUATION_SHARE_DATA_OFFSET;
const FIRST_SHARE_FLAG = 1;

interface ParsedShare {
  infoByte: string;
  /** Bytes 10-13 of a first share; null for a continuation share. */
  sequenceLength: number | null;
  dataHex: string;
}

/** Reads a share given as 128 hex characters; only shares of the original quadrant can be first shares. */
export function parseShare(shareHex: string, original: boolean): ParsedShare {
  const infoByte = shareHex.slice(INFO_BYTE_OFFSET * 2, (INFO_BYTE_OFFSET + 1) * 2);
  const first = original && (parseInt(infoByte, 16) & FIRST_SHARE_FLAG) === FIRST_SHARE_FLAG;
  return first
    ? { infoByte, sequenceLength: parseInt(shareHex.slice(SEQUENCE_LENGTH_OFFSET * 2, FIRST_SHARE_DATA_OFFSET * 2), 16), dataHex: shareHex.slice(FIRST_SHARE_DATA_OFFSET * 2) }
    : { infoByte, sequenceLength: null, dataHex: shareHex.slice(CONTINUATION_SHARE_DATA_OFFSET * 2) };
}
