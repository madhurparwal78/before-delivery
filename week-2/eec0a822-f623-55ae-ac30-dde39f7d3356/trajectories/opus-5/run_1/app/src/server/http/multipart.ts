import { unsupportedMediaType } from './errors.js';
import { isMultipart, multipartBoundary, type Ctx } from './router.js';

export interface MultipartPart {
  readonly name: string;
  readonly fileName: string | null;
  readonly contentType: string | null;
  readonly content: Buffer;
}

function headerValue(headerBlock: string, name: string): string | null {
  const pattern = new RegExp(`^${name}:\\s*(.*)$`, 'im');
  const match = pattern.exec(headerBlock);
  return match === null ? null : match[1].trim();
}

function dispositionField(disposition: string, key: string): string | null {
  const match = new RegExp(`${key}="([^"]*)"`).exec(disposition);
  return match === null ? null : match[1];
}

export function parseMultipart(ctx: Ctx): MultipartPart[] {
  if (!isMultipart(ctx)) throw unsupportedMediaType();
  const boundary = multipartBoundary(ctx);
  if (boundary === null) throw unsupportedMediaType();
  const delimiter = Buffer.from(`--${boundary}`);
  const body = ctx.rawBody;
  const parts: MultipartPart[] = [];
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    let start = cursor + delimiter.length;
    if (body.slice(start, start + 2).toString('latin1') === '--') break;
    if (body.slice(start, start + 2).toString('latin1') === '\r\n') start += 2;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const chunk = body.slice(start, next - 2);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headerBlock = chunk.slice(0, headerEnd).toString('utf8');
      const disposition = headerValue(headerBlock, 'content-disposition');
      if (disposition !== null) {
        parts.push({
          name: dispositionField(disposition, 'name') ?? '',
          fileName: dispositionField(disposition, 'filename'),
          contentType: headerValue(headerBlock, 'content-type'),
          content: chunk.slice(headerEnd + 4),
        });
      }
    }
    cursor = next;
  }
  return parts;
}

export function filePart(ctx: Ctx, fieldName: string): MultipartPart | null {
  return parseMultipart(ctx).find((part) => part.name === fieldName) ?? null;
}
