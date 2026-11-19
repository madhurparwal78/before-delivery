// Reads request bodies with the published limits. JSON ≤ 65,536 bytes; multipart ≤ 50,400,000 bytes.

import { IncomingMessage } from 'node:http';
import { errors } from './errors';

export const JSON_BODY_LIMIT = 65536;
export const MULTIPART_BODY_LIMIT = 50400000;

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (declared > limit) {
      reject(errors.payloadTooLarge());
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(errors.payloadTooLarge());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (e) => reject(e));
  });
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const ct = String(req.headers['content-type'] ?? '');
  if (!ct.toLowerCase().startsWith('application/json')) throw errors.unsupportedMedia();
  const body = await readBody(req, JSON_BODY_LIMIT);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type MultipartFile = { filename: string; contentType: string; data: Buffer };
export type MultipartResult = {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
};

/** Minimal multipart/form-data parser: sufficient for the single-file fields this app posts. */
export async function readMultipart(req: IncomingMessage): Promise<MultipartResult> {
  const ct = String(req.headers['content-type'] ?? '');
  const m = /boundary="?([^";]+)"?/i.exec(ct);
  if (!m) throw errors.unsupportedMedia();
  const boundary = Buffer.from(`--${m[1]}`);
  const body = await readBody(req, MULTIPART_BODY_LIMIT);
  const result: MultipartResult = { fields: {}, files: {} };

  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const partStart = pos + boundary.length;
    if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) break; // closing --
    // skip CRLF after boundary
    let headStart = partStart;
    if (body[headStart] === 0x0d && body[headStart + 1] === 0x0a) headStart += 2;
    const headEnd = body.indexOf('\r\n\r\n', headStart);
    if (headEnd === -1) break;
    const headers = body.subarray(headStart, headEnd).toString('utf8');
    const next = body.indexOf(boundary, headEnd + 4);
    if (next === -1) break;
    let dataEnd = next;
    if (body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) dataEnd -= 2;
    const data = body.subarray(headEnd + 4, dataEnd);

    const nameMatch = /name="([^"]*)"/i.exec(headers);
    const fileMatch = /filename="([^"]*)"/i.exec(headers);
    const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
    const name = nameMatch ? nameMatch[1] : '';
    if (fileMatch) {
      result.files[name] = { filename: fileMatch[1], contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream', data: Buffer.from(data) };
    } else {
      result.fields[name] = data.toString('utf8');
    }
    pos = next;
  }
  return result;
}
