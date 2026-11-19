import { Ctx } from './http.js';
import { unsupportedMediaType } from './errors.js';

export type FilePart = { name: string; filename: string; contentType: string; bytes: Buffer };
export type MultipartBody = { fields: Record<string, string>; files: FilePart[] };

function boundaryOf(ctx: Ctx): string | null {
  const header = ctx.header('content-type') ?? '';
  const [type, ...rest] = header.split(';');
  if (type.trim().toLowerCase() !== 'multipart/form-data') return null;
  for (const part of rest) {
    const [key, ...value] = part.trim().split('=');
    if (key.toLowerCase() === 'boundary') return value.join('=').replace(/^"|"$/g, '');
  }
  return null;
}

export function readMultipart(ctx: Ctx, raw: Buffer): MultipartBody {
  const boundary = boundaryOf(ctx);
  if (!boundary) throw unsupportedMediaType();
  const marker = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: FilePart[] = [];
  let at = raw.indexOf(marker);
  while (at !== -1) {
    const start = at + marker.length;
    if (raw.subarray(start, start + 2).toString('latin1') === '--') break;
    const headerEnd = raw.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = raw.subarray(start, headerEnd).toString('utf8');
    const next = raw.indexOf(marker, headerEnd);
    const bodyEnd = next === -1 ? raw.length : next - 2;
    const bytes = raw.subarray(headerEnd + 4, bodyEnd);
    const disposition = /name="([^"]*)"/.exec(headerText);
    const filename = /filename="([^"]*)"/.exec(headerText);
    const contentType = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const name = disposition ? disposition[1] : '';
    if (filename) {
      files.push({
        name,
        filename: filename[1],
        contentType: contentType ? contentType[1].trim() : 'application/octet-stream',
        bytes,
      });
    } else {
      fields[name] = bytes.toString('utf8');
    }
    at = next;
  }
  return { fields, files };
}

export function filePartSize(ctx: Ctx, raw: Buffer): number {
  try {
    const parsed = readMultipart(ctx, raw);
    return parsed.files.reduce((largest, file) => Math.max(largest, file.bytes.length), 0);
  } catch {
    return 0;
  }
}
