export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  bytes: Buffer;
}

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : value.trim();
}

export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = body.subarray(start, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    const bodyEnd = next === -1 ? body.length : next - 2;
    const bytes = body.subarray(headerEnd + 4, bodyEnd);
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    const contentType = /content-type:\s*([^\r\n;]+)/i.exec(headerText)?.[1]?.trim() ?? null;
    if (name !== undefined) parts.push({ name, filename, contentType, bytes });
    cursor = next;
  }
  return parts;
}

export function fieldValue(parts: readonly MultipartPart[], name: string): string | null {
  const part = parts.find((entry) => entry.name === name && entry.filename === null);
  return part === undefined ? null : part.bytes.toString('utf8').trim();
}

export function filePart(parts: readonly MultipartPart[], name: string): MultipartPart | null {
  return parts.find((entry) => entry.name === name && entry.filename !== null) ?? null;
}
