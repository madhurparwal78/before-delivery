import busboy from 'busboy';
import { Err } from './errors.js';
import type { Ctx } from './http.js';

export interface UploadedFile {
  field: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: UploadedFile[];
}

export function requireMultipart(ctx: Ctx): void {
  const base = ctx.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base !== 'multipart/form-data') throw Err.unsupportedMediaType();
}

export async function parseMultipart(ctx: Ctx): Promise<MultipartBody> {
  requireMultipart(ctx);
  return new Promise<MultipartBody>((resolve, reject) => {
    const parser = busboy({ headers: { 'content-type': ctx.contentType } });
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        files.push({
          field: name,
          filename: info.filename,
          contentType: info.mimeType,
          bytes: Buffer.concat(chunks),
        });
      });
    });
    parser.on('close', () => resolve({ fields, files }));
    parser.on('error', () => reject(Err.unsupportedMediaType()));
    parser.end(ctx.bytes);
  });
}

export type SniffedKind = 'glb' | 'png' | 'jpeg' | 'zip' | 'unknown';

/** Models and textures are recognised by their leading bytes. */
export function sniff(bytes: Buffer): SniffedKind {
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'glTF') return 'glb';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'zip';
  }
  return 'unknown';
}
