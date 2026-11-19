import type { IncomingMessage, ServerResponse } from 'http';
import { ApiError } from '../http/errors.js';

export const JSON_MAX_BYTES = 65_536;

export function readBody(req: IncomingMessage, res: ServerResponse, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      // Drain the socket so the client can read the 413 answer.
      req.resume();
      reject(new ApiError(413, 'payload_too_large'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        chunks.length = 0;
        req.resume();
        reject(new ApiError(413, 'payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) return;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!over) reject(new ApiError(413, 'payload_too_large'));
    });
  });
}

/** Reads a multipart/form-data body, returning the `file` part. */
export function readMultipartFile(req: IncomingMessage, maxBytes: number): Promise<{ file: Buffer; filename: string } | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new ApiError(413, 'payload_too_large'));
      req.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ApiError(413, 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const whole = Buffer.concat(chunks);
      const ct = req.headers['content-type'] ?? '';
      const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
      if (!m) {
        resolve(null);
        return;
      }
      const boundary = '--' + (m[1] ?? m[2]).trim();
      const file = extractFilePart(whole, boundary);
      resolve(file);
    });
    req.on('error', () => reject(new ApiError(413, 'payload_too_large')));
  });
}

function extractFilePart(body: Buffer, boundary: string): { file: Buffer; filename: string } | null {
  const startMarker = Buffer.from(boundary + '\r\n');
  const parts: Buffer[] = [];
  let idx = body.indexOf(startMarker);
  while (idx >= 0) {
    const headerStart = idx + startMarker.length;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd < 0) break;
    const headers = body.toString('utf8', headerStart, headerEnd);
    const nextBoundary = body.indexOf(Buffer.from('\r\n' + boundary), headerEnd + 4);
    const contentEnd = nextBoundary < 0 ? body.length - (boundary.startsWith('--') ? 2 : 0) : nextBoundary;
    const content = body.subarray(headerEnd + 4, contentEnd);
    parts.push(content);
    const headerText = headers;
    const nm = /name="([^"]*)"/.exec(headerText);
    const fn = /filename="([^"]*)"/.exec(headerText);
    if (nm && nm[1] === 'file') {
      return { file: content, filename: fn ? decodeURIComponent(fn[1]) : 'upload' };
    }
    idx = body.indexOf(startMarker, headerStart);
  }
  void parts;
  return null;
}
