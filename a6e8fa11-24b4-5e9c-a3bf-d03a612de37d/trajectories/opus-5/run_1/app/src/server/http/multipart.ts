export interface MultipartPart {
  name: string;
  fileName: string | null;
  data: Buffer;
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match ? match[1] ?? match[2] : null;
  return value ? value.trim() : null;
}

export function parseMultipart(body: Buffer, contentType: string | undefined): MultipartPart[] | null {
  if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) return null;
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let at = body.indexOf(marker);
  if (at < 0) return null;
  at += marker.length;
  for (;;) {
    if (body.slice(at, at + 2).toString() === '--') break;
    if (body.slice(at, at + 2).toString() === '\r\n') at += 2;
    const headerEnd = body.indexOf('\r\n\r\n', at);
    if (headerEnd < 0) break;
    const headers = body.slice(at, headerEnd).toString('utf8');
    const next = body.indexOf(marker, headerEnd);
    if (next < 0) break;
    const data = body.slice(headerEnd + 4, next - 2);
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    const fileName = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    parts.push({ name, fileName, data });
    at = next + marker.length;
  }
  return parts;
}
