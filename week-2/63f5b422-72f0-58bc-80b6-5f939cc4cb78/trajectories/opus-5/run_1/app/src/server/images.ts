import { notices } from '../shared/notices.js';
import { query } from './db.js';
import { ApiError } from './errors.js';
import { newId } from './ids.js';
import { getObject, imageKey, putObject, storageUnavailable } from './storage.js';

export interface ImageRecord {
  id: string;
  status: 'confirmed';
  fileName: string;
  width: number;
  height: number;
}

interface Inspected {
  contentType: string;
  width: number;
  height: number;
}

/** Types are recognised by signature bytes; the declared type is ignored. */
export function inspectImage(bytes: Buffer): Inspected | undefined {
  if (
    bytes.length > 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return {
      contentType: 'image/png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);
      if (sof.has(marker)) {
        return {
          contentType: 'image/jpeg',
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
    return { contentType: 'image/jpeg', width: 0, height: 0 };
  }
  if (
    bytes.length > 30 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    const chunk = bytes.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8 ') {
      return {
        contentType: 'image/webp',
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return {
        contentType: 'image/webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === 'VP8X') {
      return {
        contentType: 'image/webp',
        width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1,
        height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1,
      };
    }
  }
  return undefined;
}

/** An image becomes usable only once storage confirms it by reading it back. */
export async function storeImage(
  workspaceId: string,
  fileName: string,
  bytes: Buffer,
): Promise<ImageRecord> {
  const inspected = inspectImage(bytes);
  if (!inspected) throw new ApiError(415, 'unsupported_image', notices.uploadWrongType);
  const id = newId('img');
  const key = imageKey(workspaceId, id);
  try {
    await putObject(workspaceId, key, bytes, inspected.contentType);
    const readBack = await getObject(workspaceId, key);
    if (!readBack.body.equals(bytes)) throw storageUnavailable();
  } catch (error) {
    await query('delete from images where id = $1', [id]);
    if (error instanceof ApiError && error.status === 503) throw error;
    throw storageUnavailable();
  }
  await query(
    `insert into images (id, workspace_id, file_name, content_type, width, height, status)
     values ($1, $2, $3, $4, $5, $6, 'confirmed')`,
    [id, workspaceId, fileName, inspected.contentType, inspected.width, inspected.height],
  );
  return {
    id,
    status: 'confirmed',
    fileName,
    width: inspected.width,
    height: inspected.height,
  };
}
