export interface MultipartPart {
  name: string;
  filename: string | null;
  bytes: Buffer;
}

function headerValue(headers: string, name: string): string | null {
  for (const line of headers.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toLowerCase() === name) return line.slice(colon + 1).trim();
  }
  return null;
}

function parameter(disposition: string, name: string): string | null {
  const quoted = new RegExp(`${name}="([^"]*)"`).exec(disposition);
  if (quoted) return quoted[1] ?? null;
  const bare = new RegExp(`${name}=([^;]*)`).exec(disposition);
  return bare ? (bare[1] ?? '').trim() : null;
}

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : value.trim();
}

export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    const bodyStart = body.indexOf('\r\n\r\n', start);
    if (bodyStart === -1) break;
    const next = body.indexOf(delimiter, bodyStart);
    if (next === -1) break;
    const headers = body.slice(start, bodyStart).toString('utf8');
    const content = body.slice(bodyStart + 4, next - 2);
    const disposition = headerValue(headers, 'content-disposition') ?? '';
    parts.push({
      name: parameter(disposition, 'name') ?? '',
      filename: parameter(disposition, 'filename'),
      bytes: content,
    });
    index = next;
  }
  return parts;
}
