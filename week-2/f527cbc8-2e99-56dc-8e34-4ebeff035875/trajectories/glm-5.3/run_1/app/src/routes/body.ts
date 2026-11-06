import type { IncomingMessage } from 'node:http';
import { AppError } from '../errors.js';

/** Reads the request body up to `limit` bytes; over that answers 413 (DP-41). */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      total += c.length;
      if (total > limit) {
        done = true;
        req.removeAllListeners('data');
        reject(new AppError(413, 'payload_too_large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolveBody(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
