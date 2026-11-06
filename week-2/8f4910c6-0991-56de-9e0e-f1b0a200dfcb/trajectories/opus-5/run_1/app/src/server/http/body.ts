import type { IncomingMessage } from 'node:http';
import { tooLarge } from './errors.js';

/** Reads the request body, refusing one byte more than the route's limit. */
export async function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limitBytes) {
      // The socket stays open long enough to deliver the 413 answer.
      req.pause();
      throw tooLarge(limitBytes);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export type FilePart = { filename: string; contentType: string; bytes: Buffer };

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value ? value.trim() : null;
}

/** Extracts the part named `file` from a multipart/form-data body. */
export function parseFilePart(body: Buffer, contentType: string): FilePart | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    parts.push(body.subarray(start, next));
    index = next;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    if (name !== 'file') continue;
    let content = part.subarray(headerEnd + 4);
    if (content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a) {
      content = content.subarray(0, content.length - 2);
    }
    return {
      filename: /filename="([^"]*)"/i.exec(disposition)?.[1] ?? 'upload',
      contentType: (/content-type:([^\r\n]*)/i.exec(headerText)?.[1] ?? 'application/octet-stream').trim(),
      bytes: content,
    };
  }
  return null;
}

export function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const type = value.split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

export function isMultipartContentType(value: string | undefined): boolean {
  if (!value) return false;
  return value.split(';')[0].trim().toLowerCase() === 'multipart/form-data';
}
