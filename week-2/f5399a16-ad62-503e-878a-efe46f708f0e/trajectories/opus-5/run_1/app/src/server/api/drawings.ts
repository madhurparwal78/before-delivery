import { COPY } from '../../domain/copy.js';
import { frameSvg, seedOfFileName } from '../../domain/drawing.js';
import { readImageHeader } from '../../domain/imageHeader.js';
import { refuse } from '../http.js';
import type { Reply } from '../http.js';
import { getObject, StoreDown, storeKeys } from '../infra/store.js';

export type DrawingHolder = {
  file_name: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  drawing_kind: string | null;
};

/** Seeded drawings are generated SVG, made when read and never kept in MinIO. */
export async function drawingReply(
  owner: { client_id: string; id: string },
  frame: DrawingHolder,
): Promise<Reply> {
  if (frame.drawing_kind === null) throw refuse.notFound();
  if (frame.drawing_kind === 'seeded') {
    const svg = frameSvg(seedOfFileName(frame.file_name ?? ''), {
      width: frame.width ?? 1280,
      height: frame.height ?? 720,
    });
    return { status: 200, bytes: Buffer.from(svg, 'utf8'), contentType: 'image/svg+xml' };
  }
  const bytes = await readStored(storeKeys.frame(owner.client_id, owner.id, frame.sha256 ?? ''));
  const header = readImageHeader(bytes);
  return {
    status: 200,
    bytes,
    contentType: header?.contentType ?? 'application/octet-stream',
  };
}

export async function readStored(key: string): Promise<Buffer> {
  let bytes: Buffer | null;
  try {
    bytes = await getObject(key);
  } catch (error) {
    if (error instanceof StoreDown) throw refuse.unavailable(COPY.storeUnavailable);
    throw error;
  }
  if (bytes === null) throw refuse.notFound();
  return bytes;
}

/** The bytes of a drawing a frame holds, for a PDF's data address. */
export async function drawingBytes(
  owner: { client_id: string; id: string },
  frame: DrawingHolder,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (frame.drawing_kind === null) return null;
  if (frame.drawing_kind === 'seeded') {
    return {
      bytes: Buffer.from(
        frameSvg(seedOfFileName(frame.file_name ?? ''), {
          width: frame.width ?? 1280,
          height: frame.height ?? 720,
        }),
        'utf8',
      ),
      contentType: 'image/svg+xml',
    };
  }
  const bytes = await readStored(storeKeys.frame(owner.client_id, owner.id, frame.sha256 ?? ''));
  return { bytes, contentType: readImageHeader(bytes)?.contentType ?? 'image/png' };
}
