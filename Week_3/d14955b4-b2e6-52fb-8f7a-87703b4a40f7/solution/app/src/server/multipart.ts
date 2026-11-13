interface FilePart {
  name: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match ? ((match[1] ?? match[2]) as string) : null;
}

function disposition(header: string, key: string): string | null {
  const star = new RegExp(`${key}\\*=([^;]+)`, 'i').exec(header);
  if (star) {
    const [, rest = ''] = /^[^']*'[^']*'(.*)$/.exec((star[1] as string).trim()) ?? [];
    try {
      return decodeURIComponent(rest);
    } catch {
      return rest;
    }
  }
  const quoted = new RegExp(`${key}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(header);
  if (quoted) return (quoted[1] as string).replace(/\\(.)/g, '$1');
  const bare = new RegExp(`${key}=([^;]*)`, 'i').exec(header);
  return bare ? (bare[1] as string).trim() : null;
}

export function parseFileParts(body: Buffer, contentType: string): FilePart[] {
  const boundary = boundaryOf(contentType);
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: FilePart[] = [];
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const part = body.subarray(start + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split >= 0) {
      const head = part.subarray(0, split).toString('utf8');
      const lines = head.split('\r\n');
      const header = lines.find((line) => /^content-disposition:/i.test(line)) ?? '';
      const type = lines.find((line) => /^content-type:/i.test(line));
      const filename = disposition(header, 'filename');
      if (filename !== null) {
        parts.push({
          name: disposition(header, 'name') ?? '',
          filename,
          contentType: type ? type.slice(type.indexOf(':') + 1).trim() : '',
          bytes: Buffer.from(part.subarray(split + 4)),
        });
      }
    }
    at = next;
  }
  return parts;
}
