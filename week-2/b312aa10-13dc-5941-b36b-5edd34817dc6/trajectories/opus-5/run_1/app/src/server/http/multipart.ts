export type MultipartPart = {
  name: string;
  fileName: string | null;
  data: Buffer;
};

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value ? value.trim() : null;
}

export function parseMultipart(body: Buffer, contentType: string): MultipartPart[] | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const parts: MultipartPart[] = [];
  let index = body.indexOf(delimiter);
  if (index < 0) return null;
  index += delimiter.byteLength;

  for (;;) {
    if (body.slice(index, index + 2).toString('latin1') === '--') break;
    if (body.slice(index, index + 2).toString('latin1') === '\r\n') index += 2;
    const headerEnd = body.indexOf('\r\n\r\n', index, 'latin1');
    if (headerEnd < 0) break;
    const rawHeaders = body.slice(index, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    if (next < 0) break;
    const data = body.slice(headerEnd + 4, next - 2);

    const disposition = /content-disposition:[^\r\n]*/i.exec(rawHeaders)?.[0] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    const fileName = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    if (name !== undefined) parts.push({ name, fileName, data });
    index = next + delimiter.byteLength;
  }
  return parts;
}

/** The detected type, judged only by the file's first bytes. */
export function detectFileType(data: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (data.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.slice(0, 8).equals(png)) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}
