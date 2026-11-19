import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';

interface Part {
  fieldname: string;
  filename: string;
  data: Buffer;
}

declare module 'fastify' {
  interface FastifyRequest {
    parts?: Part[];
  }
}

/**
 * A multipart/form-data reader for photo sends. Parts keep their request
 * order; `file` parts carry their raw bytes, other parts their utf8 text.
 */
export function registerMultipart(app: FastifyInstance): void {
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (request, body, next) => {
    const contentType = request.headers['content-type'] ?? '';
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (!match) {
      const err = new Error('malformed multipart') as Error & { statusCode?: number };
      err.statusCode = 415;
      next(err, undefined);
      return;
    }
    const boundary = `--${(match[1] ?? match[2]).trim()}`;
    const buffer = body as Buffer;
    const parts: Part[] = [];
    let index = buffer.indexOf(boundary);
    while (index !== -1) {
      const nextIndex = buffer.indexOf(boundary, index + boundary.length);
      if (nextIndex === -1) break;
      const segment = buffer.subarray(index + boundary.length, nextIndex);
      const headerEnd = segment.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headerText = segment.subarray(0, headerEnd).toString('utf8');
        const data = segment.subarray(headerEnd + 4);
        const trimmed = data.subarray(0, Math.max(0, data.length - 2)); // drop trailing \r\n
        const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText);
        if (disposition) {
          const attrs = disposition[1];
          const nameMatch = /name="([^"]*)"/i.exec(attrs);
          const fileMatch = /filename="([^"]*)"/i.exec(attrs);
          parts.push({
            fieldname: nameMatch ? nameMatch[1] : '',
            filename: fileMatch ? fileMatch[1] : '',
            data: trimmed,
          });
        }
      }
      index = nextIndex;
    }
    (request as FastifyRequest & { parts?: Part[] }).parts = parts;
    next(null, parts);
  });
}
