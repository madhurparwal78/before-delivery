interface Part {
  name: string;
  filename: string | undefined;
  data: Buffer;
}

const CRLF = Buffer.from('\r\n');

function quoted(headers: string, field: string): string | undefined {
  const found = new RegExp(`${field}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(headers);
  return found?.[1]?.replace(/\\(.)/g, '$1');
}

/** Splits a multipart/form-data body into its parts. */
export function parseMultipart(body: Buffer, contentType: string): Part[] {
  const declared = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const token = declared?.[1] ?? declared?.[2];
  if (!token) return [];
  const boundary = Buffer.from(`--${token}`);
  const separator = Buffer.concat([CRLF, boundary]);
  const parts: Part[] = [];
  let at = body.indexOf(boundary);
  while (at !== -1) {
    at += boundary.length;
    if (body.subarray(at, at + 2).toString('ascii') === '--') break;
    const headerStart = body.subarray(at, at + 2).equals(CRLF) ? at + 2 : at;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) break;
    const dataStart = headerEnd + 4;
    const dataEnd = body.indexOf(separator, dataStart);
    if (dataEnd === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    parts.push({ name: quoted(headers, 'name') ?? '', filename: quoted(headers, 'filename'), data: body.subarray(dataStart, dataEnd) });
    at = body.indexOf(boundary, dataEnd + 2);
  }
  return parts;
}
