import busboy from 'busboy';
import { Readable } from 'node:stream';
import { ApiError } from './errors.js';

export interface MultipartFile {
  fieldName: string;
  declaredType: string;
  data: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: MultipartFile[];
}

export async function parseMultipart(
  body: Buffer,
  contentType: string,
  fileSizeLimit: number,
): Promise<MultipartBody> {
  return new Promise<MultipartBody>((resolve, reject) => {
    const parser = busboy({
      headers: { 'content-type': contentType },
      limits: { fileSize: fileSizeLimit, files: 4, fields: 20 },
    });
    const fields: Record<string, string> = {};
    const files: MultipartFile[] = [];
    let failure: Error | null = null;

    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        failure = new ApiError('payload_too_large');
      });
      stream.on('end', () => {
        files.push({ fieldName: name, declaredType: info.mimeType, data: Buffer.concat(chunks) });
      });
    });
    parser.on('error', (error: Error) => reject(error));
    parser.on('close', () => {
      if (failure !== null) {
        reject(failure);
        return;
      }
      resolve({ fields, files });
    });

    Readable.from(body).pipe(parser);
  });
}
