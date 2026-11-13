// Request body reading with the published limits; a body past the limit is refused.

import type { IncomingMessage } from 'node:http';

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > limit) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return readBody(req, limit);
}
