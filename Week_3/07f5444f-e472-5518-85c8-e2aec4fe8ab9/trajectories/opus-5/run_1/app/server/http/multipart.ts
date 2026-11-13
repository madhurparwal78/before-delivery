import { Readable } from 'node:stream';
import busboy from 'busboy';
import { unsupportedMediaType } from './errors.js';

export interface MultipartFile {
  fieldName: string;
  filenameParameter: string;
  contentType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Map<string, string>;
  files: MultipartFile[];
}

export async function parseMultipart(contentType: string | undefined, body: Buffer): Promise<MultipartBody> {
  if (!contentType || !contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw unsupportedMediaType();
  }
  const parser = busboy({
    headers: { 'content-type': contentType },
    defParamCharset: 'utf8',
    limits: { files: 2, fields: 10 },
  });
  const result: MultipartBody = { fields: new Map(), files: [] };
  return await new Promise<MultipartBody>((resolve, reject) => {
    parser.on('field', (name, value) => {
      result.fields.set(name, value);
    });
    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        result.files.push({
          fieldName: name,
          filenameParameter: info.filename ?? '',
          contentType: info.mimeType,
          bytes: Buffer.concat(chunks),
        });
      });
    });
    parser.on('close', () => resolve(result));
    parser.on('error', () => reject(unsupportedMediaType()));
    Readable.from(body).pipe(parser);
  });
}
