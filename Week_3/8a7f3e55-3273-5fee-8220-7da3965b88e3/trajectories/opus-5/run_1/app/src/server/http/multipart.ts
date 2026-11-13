export interface FilePart {
  fieldName: string;
  fileName: string;
  bytes: Buffer;
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : value.trim();
}

function headerValue(headers: string, name: string): string | null {
  for (const line of headers.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() === name) return line.slice(colon + 1).trim();
  }
  return null;
}

function parameter(value: string, name: string): string | null {
  const quoted = new RegExp(`${name}="([^"]*)"`, 'i').exec(value);
  if (quoted?.[1] !== undefined) return quoted[1];
  const bare = new RegExp(`${name}=([^;]+)`, 'i').exec(value);
  return bare?.[1]?.trim() ?? null;
}

/** Reads the file parts out of a buffered multipart body. */
export function parseFileParts(body: Buffer, contentType: string): FilePart[] {
  const boundary = boundaryOf(contentType);
  if (boundary === null) return [];
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const parts: FilePart[] = [];
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    const afterDelimiter = cursor + delimiter.length;
    if (body.subarray(afterDelimiter, afterDelimiter + 2).toString('latin1') === '--') break;
    const headerStart = afterDelimiter + 2;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart, 'latin1');
    if (headerEnd < 0) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const next = body.indexOf(delimiter, bodyStart);
    const bodyEnd = next < 0 ? body.length : next - 2;
    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const fieldName = parameter(disposition, 'name');
    const fileName = parameter(disposition, 'filename');
    if (fieldName !== null && fileName !== null) {
      parts.push({
        fieldName,
        fileName,
        bytes: Buffer.from(body.subarray(bodyStart, Math.max(bodyStart, bodyEnd))),
      });
    }
    if (next < 0) break;
    cursor = next;
  }
  return parts;
}
