import type { Request } from 'express';
import { bodyTooLarge } from './errors.js';

/** Reading multipart uploads without buffering more than the kind allows. */

export interface MultipartFile {
  name: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Map<string, string>;
  files: MultipartFile[];
}

function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary ? boundary.trim() : null;
}

function readBody(req: Request, limitBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(bodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseHeaders(block: Buffer): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.toString('utf8').split('\r\n')) {
    const index = line.indexOf(':');
    if (index > 0) {
      headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
    }
  }
  return headers;
}

function parseDisposition(value: string): { name: string; fileName: string | null } {
  const name = /name="([^"]*)"/.exec(value)?.[1] ?? '';
  const fileName = /filename="([^"]*)"/.exec(value)?.[1] ?? null;
  return { name, fileName };
}

/**
 * Parse a multipart body. `limitBytes` is the whole request's allowance, which
 * is the kind's file limit plus the published slack for the envelope.
 */
export async function parseMultipart(req: Request, limitBytes: number): Promise<MultipartBody> {
  const boundary = boundaryOf(req.header('content-type'));
  if (!boundary) return { fields: new Map(), files: [] };
  const body = await readBody(req, limitBytes);

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  const files: MultipartFile[] = [];

  let position = body.indexOf(delimiter);
  while (position >= 0) {
    let start = position + delimiter.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break; // closing boundary
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;

    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const headers = parseHeaders(body.subarray(start, headerEnd));
    const contentStart = headerEnd + 4;

    const next = body.indexOf(delimiter, contentStart);
    const contentEnd = next < 0 ? body.length : next - 2;
    const content = body.subarray(contentStart, Math.max(contentStart, contentEnd));

    const disposition = parseDisposition(headers.get('content-disposition') ?? '');
    if (disposition.fileName === null) {
      fields.set(disposition.name, content.toString('utf8'));
    } else {
      files.push({
        name: disposition.name,
        fileName: disposition.fileName,
        contentType: headers.get('content-type') ?? 'application/octet-stream',
        bytes: Buffer.from(content),
      });
    }
    position = next;
  }
  return { fields, files };
}
