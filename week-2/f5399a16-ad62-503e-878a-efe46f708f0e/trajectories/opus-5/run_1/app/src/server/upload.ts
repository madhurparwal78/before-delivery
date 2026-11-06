import { Readable } from 'node:stream';
import busboy from 'busboy';
import { UPLOAD_BODY_LIMIT } from './config.js';
import type { Context } from './http.js';
import { readRaw, refuse } from './http.js';

export type UploadedFile = {
  field: string;
  fileName: string;
  declaredType: string;
  bytes: Buffer;
};

export type Upload = {
  files: UploadedFile[];
  fields: Record<string, string>;
};

export type UploadLimit = { bytes: number; message: string };

/**
 * The whole body is judged first, then each file on its own, both as JSON.
 * Nothing is authenticated until the sizes have passed.
 */
export async function readUpload(context: Context, limit: UploadLimit): Promise<Upload> {
  const declared = Number(context.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > UPLOAD_BODY_LIMIT) {
    throw refuse.tooLarge('That body is over 9,000,000 bytes.');
  }
  const type = String(context.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('multipart/form-data')) throw refuse.unsupportedUpload();
  const raw = await readRaw(
    context.request,
    UPLOAD_BODY_LIMIT,
    'That body is over 9,000,000 bytes.',
  );

  const upload = await new Promise<Upload>((resolve, reject) => {
    const parser = busboy({ headers: { 'content-type': type } });
    const files: UploadedFile[] = [];
    const fields: Record<string, string> = {};
    let oversize = false;

    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit.bytes) {
          oversize = true;
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (oversize) return;
        files.push({
          field: name,
          fileName: info.filename ?? '',
          declaredType: info.mimeType ?? '',
          bytes: Buffer.concat(chunks),
        });
      });
    });
    parser.on('error', () => reject(refuse.unsupportedUpload()));
    parser.on('close', () => {
      if (oversize) {
        reject(refuse.tooLarge(limit.message));
        return;
      }
      resolve({ files, fields });
    });
    Readable.from(raw).pipe(parser);
  });
  return upload;
}

export function requireFile(upload: Upload, field: string): UploadedFile {
  const file = upload.files.find((candidate) => candidate.field === field);
  if (!file) throw refuse.value('Choose a file to send.');
  return file;
}
