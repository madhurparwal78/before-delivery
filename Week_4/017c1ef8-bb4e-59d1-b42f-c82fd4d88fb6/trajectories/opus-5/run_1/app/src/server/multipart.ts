import type { IncomingMessage } from 'node:http';
import { unsupportedMediaType } from './errors';
import { readBody } from './http';

export const MULTIPART_OVERHEAD = 65536;

export type UploadedFile = { filename: string; contentType: string; bytes: Buffer };

/** Uploads are multipart/form-data with one part named `file`. */
export async function readUpload(req: IncomingMessage, fileLimit: number): Promise<UploadedFile> {
  const header = req.headers['content-type'] ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(header);
  if (!header.toLowerCase().startsWith('multipart/form-data') || !match) {
    throw unsupportedMediaType();
  }
  const boundary = `--${match[1] ?? match[2]}`;
  const raw = await readBody(req, fileLimit + MULTIPART_OVERHEAD);
  const separator = Buffer.from(`\r\n${boundary}`, 'utf8');
  const body = Buffer.concat([Buffer.from('\r\n', 'utf8'), raw]);

  let cursor = body.indexOf(separator);
  while (cursor !== -1) {
    const headerStart = cursor + separator.length;
    if (body.subarray(headerStart, headerStart + 2).toString('utf8') === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const nextBoundary = body.indexOf(separator, headerEnd);
    const content = body.subarray(headerEnd + 4, nextBoundary === -1 ? body.length : nextBoundary);
    const nameMatch = /name="([^"]*)"/i.exec(headers);
    if (nameMatch && nameMatch[1] === 'file') {
      const filename = /filename="([^"]*)"/i.exec(headers);
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers);
      return {
        filename: filename ? filename[1] : '',
        contentType: type ? type[1].trim() : 'application/octet-stream',
        bytes: content,
      };
    }
    cursor = nextBoundary;
  }
  throw unsupportedMediaType();
}
