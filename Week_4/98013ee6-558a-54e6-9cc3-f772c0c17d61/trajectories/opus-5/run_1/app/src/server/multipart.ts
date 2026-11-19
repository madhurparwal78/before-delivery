export interface MultipartField {
  name: string;
  filename: string | null;
  data: Buffer;
}

export function parseMultipart(body: Buffer, contentType: string): MultipartField[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return [];
  const boundary = `--${(match[1] ?? match[2]).trim()}`;
  const delimiter = Buffer.from(`\r\n${boundary}`, 'utf8');
  const start = body.indexOf(Buffer.from(boundary, 'utf8'));
  if (start < 0) return [];
  const fields: MultipartField[] = [];
  let cursor = start + boundary.length;
  for (;;) {
    if (body.subarray(cursor, cursor + 2).toString('utf8') === '--') break;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n', 'utf8'), cursor);
    if (headerEnd < 0) break;
    const headerText = body.subarray(cursor, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd + 4);
    const end = next < 0 ? body.length : next;
    const data = body.subarray(headerEnd + 4, end);
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    if (name !== undefined) fields.push({ name, filename, data: Buffer.from(data) });
    if (next < 0) break;
    cursor = next + delimiter.length;
  }
  return fields;
}

export function textField(fields: MultipartField[], name: string): string | null {
  const field = fields.find((item) => item.name === name && item.filename === null);
  return field ? field.data.toString('utf8') : null;
}

export function fileField(fields: MultipartField[], name: string): MultipartField | null {
  return fields.find((item) => item.name === name && item.filename !== null) ?? null;
}
