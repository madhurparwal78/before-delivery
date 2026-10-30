export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  content: Buffer;
}

function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value ? value.trim() : null;
}

function parseDisposition(header: string): { name: string; filename: string | null } {
  const name = /name="([^"]*)"/i.exec(header)?.[1] ?? '';
  const filename = /filename="([^"]*)"/i.exec(header)?.[1] ?? null;
  return { name, filename };
}

/** Reads a `multipart/form-data` body into its parts. */
export function parseMultipart(body: Buffer, contentType: string | undefined): MultipartPart[] | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const parts: MultipartPart[] = [];
  let index = body.indexOf(delimiter);
  if (index < 0) return null;
  index += delimiter.length;
  while (index < body.length) {
    if (body[index] === 0x2d && body[index + 1] === 0x2d) break;
    if (body[index] === 0x0d && body[index + 1] === 0x0a) index += 2;
    const headerEnd = body.indexOf('\r\n\r\n', index, 'utf8');
    if (headerEnd < 0) break;
    const headerText = body.subarray(index, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    if (next < 0) break;
    const contentEnd = next - 2;
    const content = body.subarray(headerEnd + 4, Math.max(headerEnd + 4, contentEnd));
    const headers = new Map<string, string>();
    for (const line of headerText.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.set(line.slice(0, colon).toLowerCase().trim(), line.slice(colon + 1).trim());
    }
    const disposition = parseDisposition(headers.get('content-disposition') ?? '');
    parts.push({
      name: disposition.name,
      filename: disposition.filename,
      contentType: headers.get('content-type') ?? null,
      content: Buffer.from(content),
    });
    index = next + delimiter.length;
  }
  return parts;
}

/** The upload keeps the file name for display only, with any directory parts removed. */
export function displayFilename(filename: string | null): string {
  if (!filename) return 'upload';
  const base = filename.split(/[\\/]/).pop() ?? 'upload';
  return base.length > 0 ? base : 'upload';
}
