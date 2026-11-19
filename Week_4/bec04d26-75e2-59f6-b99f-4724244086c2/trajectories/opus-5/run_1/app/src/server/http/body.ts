import { IncomingMessage } from 'node:http';
import { badJson, tooLarge, unsupportedMediaType } from './errors';

export const MAX_BODY_BYTES = 100000;

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      throw tooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Body limits, content type and JSON parsing, all ahead of the error order. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
    throw tooLarge();
  }
  const raw = await readRaw(req);
  if (raw.length === 0) return {};
  const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw unsupportedMediaType();
  }
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw badJson();
  }
}
