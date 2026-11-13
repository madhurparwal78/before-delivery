export type MultipartFile = {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
};

export type MultipartForm = {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, MultipartFile>>;
};

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (match === null) return null;
  return (match[1] ?? match[2] ?? '').trim() || null;
}

function headerValue(headers: string, name: string): string | null {
  const pattern = new RegExp(`^${name}:\\s*(.*)$`, 'im');
  const match = pattern.exec(headers);
  return match === null ? null : (match[1] as string).trim();
}

function parameterOf(value: string, name: string): string | null {
  const match = new RegExp(`${name}=(?:"([^"]*)"|([^;]*))`, 'i').exec(value);
  if (match === null) return null;
  return match[1] ?? (match[2] ?? '').trim();
}

export function parseMultipart(body: Buffer, boundary: string): MultipartForm {
  const fields: Record<string, string> = {};
  const files: Record<string, MultipartFile> = {};
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    let start = cursor + delimiter.length;
    if (body.slice(start, start + 2).toString('latin1') === '--') break;
    if (body.slice(start, start + 2).toString('latin1') === '\r\n') start += 2;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = body.slice(start, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const next = body.indexOf(delimiter, contentStart);
    const contentEnd = next === -1 ? body.length : next - 2;
    const content = body.slice(contentStart, Math.max(contentStart, contentEnd));

    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const name = parameterOf(disposition, 'name');
    if (name !== null) {
      const filename = parameterOf(disposition, 'filename');
      if (filename === null) {
        fields[name] = content.toString('utf8');
      } else {
        files[name] = {
          filename,
          contentType: headerValue(headers, 'content-type') ?? 'application/octet-stream',
          bytes: content,
        };
      }
    }
    cursor = next;
  }
  return { fields, files };
}
