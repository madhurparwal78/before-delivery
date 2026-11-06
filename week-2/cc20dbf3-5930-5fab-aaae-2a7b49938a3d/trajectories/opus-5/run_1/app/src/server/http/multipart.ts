/** The one multipart field the API accepts is the photo file. */
export interface MultipartFile {
  readonly field: string;
  readonly bytes: Buffer;
}

function headerValue(headers: string, name: string): string | null {
  const pattern = new RegExp(`^${name}:\\s*(.*)$`, 'im');
  const match = pattern.exec(headers);
  return match?.[1]?.trim() ?? null;
}

export function parseMultipart(contentType: string, body: Buffer): MultipartFile[] {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (boundary === undefined) return [];
  const delimiter = Buffer.from(`--${boundary.trim()}`, 'utf8');
  const files: MultipartFile[] = [];
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) return [];
  cursor += delimiter.length;
  for (;;) {
    if (body.slice(cursor, cursor + 2).toString('latin1') === '--') break;
    if (body.slice(cursor, cursor + 2).toString('latin1') === '\r\n') cursor += 2;
    const headerEnd = body.indexOf('\r\n\r\n', cursor);
    if (headerEnd < 0) break;
    const headers = body.slice(cursor, headerEnd).toString('utf8');
    const partStart = headerEnd + 4;
    const nextDelimiter = body.indexOf(delimiter, partStart);
    if (nextDelimiter < 0) break;
    let partEnd = nextDelimiter;
    if (body.slice(partEnd - 2, partEnd).toString('latin1') === '\r\n') partEnd -= 2;
    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const nameMatch = /name="([^"]*)"/i.exec(disposition);
    files.push({
      field: nameMatch?.[1] ?? '',
      bytes: body.slice(partStart, partEnd),
    });
    cursor = nextDelimiter + delimiter.length;
  }
  return files;
}
