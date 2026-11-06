import { LIMITS } from '../config.ts';
import type { Ctx } from './context.ts';
import { tooLarge, unsupportedMediaType } from './errors.ts';

export interface UploadedFile {
  fieldName: string;
  fileName: string;
  declaredType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: UploadedFile[];
}

export class PartTooLarge extends Error {
  constructor() {
    super('part too large');
    this.name = 'PartTooLarge';
  }
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = (match?.[1] ?? match?.[2] ?? '').trim();
  return value === '' ? null : value;
}

interface PartHeaders {
  name: string;
  fileName: string | null;
  contentType: string;
}

function readPartHeaders(block: Buffer): PartHeaders | null {
  const text = block.toString('utf8');
  const disposition = /content-disposition:([^\r\n]*)/i.exec(text);
  if (disposition === null) return null;
  const line = disposition[1] as string;
  const name = /\bname="([^"]*)"/i.exec(line)?.[1];
  if (name === undefined) return null;
  const fileName = /\bfilename="([^"]*)"/i.exec(line)?.[1] ?? null;
  const contentType = /content-type:\s*([^\r\n;]+)/i.exec(text)?.[1]?.trim() ?? '';
  return { name, fileName, contentType };
}

async function readWholeBody(ctx: Ctx, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  let over = false;
  for await (const chunk of ctx.request) {
    const bytes = chunk as Buffer;
    length += bytes.length;
    if (length > limitBytes) {
      over = true;
      continue;
    }
    chunks.push(bytes);
  }
  if (over) throw new PartTooLarge();
  return Buffer.concat(chunks);
}

/**
 * Reads a multipart body with one file limit, plus the published envelope allowance for headers
 * and the other parts.
 */
export async function readMultipart(ctx: Ctx, fileLimitBytes: number): Promise<MultipartBody> {
  const contentType = ctx.header('content-type');
  if (contentType === null || !contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw unsupportedMediaType();
  }
  const boundary = boundaryOf(contentType);
  if (boundary === null) throw unsupportedMediaType();

  const body = await readWholeBody(ctx, fileLimitBytes + LIMITS.multipartEnvelopeBytes);
  const marker = Buffer.from(`--${boundary}`, 'utf8');
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];

  let cursor = body.indexOf(marker);
  if (cursor === -1) throw unsupportedMediaType();
  cursor += marker.length;

  for (;;) {
    if (body.slice(cursor, cursor + 2).toString('latin1') === '--') break;
    if (body.slice(cursor, cursor + 2).toString('latin1') === '\r\n') cursor += 2;
    const headerEnd = body.indexOf('\r\n\r\n', cursor);
    if (headerEnd === -1) break;
    const headers = readPartHeaders(body.subarray(cursor, headerEnd));
    const contentStart = headerEnd + 4;
    let next = body.indexOf(marker, contentStart);
    if (next === -1) next = body.length;
    const contentEnd = body.lastIndexOf('\r\n', next);
    const content = body.subarray(contentStart, contentEnd === -1 ? next : contentEnd);

    if (headers !== null) {
      if (headers.fileName === null) {
        fields[headers.name] = content.toString('utf8');
      } else {
        if (content.length > fileLimitBytes) throw new PartTooLarge();
        files.push({
          fieldName: headers.name,
          fileName: headers.fileName,
          declaredType: headers.contentType,
          bytes: Buffer.from(content),
        });
      }
    }
    if (next >= body.length) break;
    cursor = next + marker.length;
  }

  const envelope = body.length - files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (envelope > LIMITS.multipartEnvelopeBytes) throw tooLarge();
  return { fields, files };
}
