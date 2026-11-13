export interface FilePart {
  name: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}

function headerValue(headers: string, name: string): string | null {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(headers);
  return match === null ? null : match[1].trim();
}

function parameter(value: string, name: string): string | null {
  const quoted = new RegExp(`${name}="([^"]*)"`, 'i').exec(value);
  if (quoted !== null) return quoted[1];
  const bare = new RegExp(`${name}=([^;]+)`, 'i').exec(value);
  return bare === null ? null : bare[1].trim();
}

export function boundaryOf(contentType: string): string | null {
  return parameter(contentType, 'boundary');
}

export function parseMultipart(body: Buffer, boundary: string): FilePart[] {
  const marker = Buffer.from(`--${boundary}`);
  const parts: FilePart[] = [];
  let cursor = body.indexOf(marker);
  while (cursor !== -1) {
    const start = cursor + marker.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(marker, start);
    if (next === -1) break;
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf('\r\n\r\n');
    if (split !== -1) {
      const headers = chunk.subarray(0, split).toString('utf8');
      const disposition = headerValue(headers, 'content-disposition') ?? '';
      const name = parameter(disposition, 'name');
      const fileName = parameter(disposition, 'filename');
      if (name !== null && fileName !== null) {
        parts.push({
          name,
          fileName,
          contentType: headerValue(headers, 'content-type') ?? 'application/octet-stream',
          data: chunk.subarray(split + 4),
        });
      }
    }
    cursor = next;
  }
  return parts;
}
