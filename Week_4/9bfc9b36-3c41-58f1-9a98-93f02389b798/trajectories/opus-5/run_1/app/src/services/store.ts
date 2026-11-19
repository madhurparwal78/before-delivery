import { getObject, putObject, sha256OfBytes, StoreUnreachable } from './s3';

/**
 * The one place that decides whether the store holds exactly the bytes we
 * rendered. The object's own `sha256` metadata never confirms anything: only the
 * bytes read back do.
 */

function matches(bytes: Buffer, expected: Buffer): boolean {
  return bytes.length === expected.length && sha256OfBytes(bytes) === sha256OfBytes(expected);
}

/**
 * Reads the content-addressed key back and compares the bytes. A key that is
 * missing or holds other bytes is written once, then read back and compared
 * again, so a planted object never confirms and no second object is written.
 */
export async function writeAndConfirm(
  key: string,
  bytes: Buffer,
  contentType: string,
  metadata: Readonly<Record<string, string>>,
): Promise<boolean> {
  const first = await getObject(key);
  if (first !== null && matches(first.bytes, bytes)) return true;
  await putObject(key, bytes, contentType, metadata);
  const second = await getObject(key);
  return second !== null && matches(second.bytes, bytes);
}

export async function confirmQuietly(
  key: string,
  bytes: Buffer,
  contentType: string,
  metadata: Readonly<Record<string, string>>,
): Promise<boolean> {
  try {
    return await writeAndConfirm(key, bytes, contentType, metadata);
  } catch (cause) {
    if (cause instanceof StoreUnreachable) return false;
    throw cause;
  }
}

export function cutSheetKey(drawingCode: string, sha256: string): string {
  return `cut-sheets/${drawingCode}/${sha256}.svg`;
}

export function tapePhotoKey(
  boatCode: string,
  measurementId: string,
  sha256: string,
  contentType: string,
): string {
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  return `tape-photos/${boatCode}/${measurementId}/${sha256}.${extension}`;
}

export const CUT_SHEET_CONTENT_TYPE = 'image/svg+xml';
