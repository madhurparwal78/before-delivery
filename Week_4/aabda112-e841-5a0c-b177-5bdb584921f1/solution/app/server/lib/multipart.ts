import type { IncomingMessage } from 'node:http';

interface MultipartFile {
  name: string;
  bytes: Buffer;
  /** True when the part did not end inside the kept bytes, so it was larger than the cap allows. */
  truncated: boolean;
}

interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

/** Reads the request, keeping at most `cap` bytes and draining the rest, so an oversized upload still answers. */
async function readCapped(req: IncomingMessage, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let kept = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    if (kept >= cap) continue;
    const take = buf.subarray(0, cap - kept);
    chunks.push(take);
    kept += take.length;
  }
  return Buffer.concat(chunks);
}

function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) return null;
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2]!) : null;
}

/** The value of a Content-Disposition parameter; `filename*` (RFC 5987) wins over `filename`. */
function dispositionParam(header: string, key: string): string | undefined {
  const extended = new RegExp(`;\\s*${key}\\*=([^;]*)`, 'i').exec(header);
  if (extended) {
    const value = extended[1]!.trim();
    const quote = value.indexOf("''");
    try {
      return decodeURIComponent(quote >= 0 ? value.slice(quote + 2) : value);
    } catch {
      return undefined;
    }
  }
  const plain = new RegExp(`;\\s*${key}=(?:"((?:[^"\\\\]|\\\\.)*)"|([^;]*))`, 'i').exec(header);
  if (!plain) return undefined;
  return plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2]!.trim();
}

/**
 * Parses a multipart/form-data body. Header values are read as UTF-8 exactly as sent.
 * Returns null when the request is not multipart or has no boundary.
 */
export async function readMultipart(req: IncomingMessage, cap: number): Promise<MultipartBody | null> {
  const boundary = boundaryOf(req.headers['content-type']);
  if (!boundary) {
    req.resume();
    return null;
  }
  const body = await readCapped(req, cap);
  const result: MultipartBody = { fields: {}, files: {} };
  const delimiter = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  let at = body.indexOf(delimiter);
  if (at < 0) return result;
  at += delimiter.length;
  while (at < body.length) {
    if (body.subarray(at, at + 2).toString('latin1') === '--') break;
    const headerStart = body.indexOf('\r\n', at);
    if (headerStart < 0) break;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd < 0) break;
    const headers = body.subarray(headerStart + 2, headerEnd).toString('utf8').split('\r\n');
    const disposition = headers.find((h) => /^content-disposition:/i.test(h)) ?? '';
    const name = dispositionParam(disposition, 'name');
    const filename = dispositionParam(disposition, 'filename');
    const contentStart = headerEnd + 4;
    const next = body.indexOf(separator, contentStart);
    const content = body.subarray(contentStart, next < 0 ? body.length : next);
    if (name !== undefined) {
      if (filename !== undefined) {
        if (!(name in result.files)) result.files[name] = { name: filename, bytes: Buffer.from(content), truncated: next < 0 };
      } else if (next >= 0) {
        result.fields[name] = content.toString('utf8');
      }
    }
    if (next < 0) break;
    at = next + separator.length;
  }
  return result;
}
