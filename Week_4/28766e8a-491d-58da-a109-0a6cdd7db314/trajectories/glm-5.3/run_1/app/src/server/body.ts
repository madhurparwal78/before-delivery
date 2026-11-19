import type { IncomingMessage } from 'node:http';
import { ApiError } from '../shared/errors.js';

const MAX_BODY = 1_000_000;

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise<Buffer>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY + 1) {
        reject(new ApiError(413, 'too_large', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

export function parseJsonBody(raw: Buffer): unknown {
  if (raw.length === 0) return undefined;
  const text = raw.toString('utf8');
  if (!isJsonRequest(text)) {
    throw new ApiError(415, 'unsupported_media_type', 'Expected JSON.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(415, 'unsupported_media_type', 'Expected JSON.');
  }
}

function isJsonRequest(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')
    || trimmed.startsWith('-') || trimmed.startsWith('0') || trimmed.startsWith('t') || trimmed.startsWith('f') || trimmed.startsWith('n');
}
