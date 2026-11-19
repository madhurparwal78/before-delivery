/** Reads the single `file` part out of a multipart/form-data body. */
export function parseSingleFile(body: Buffer, contentType: string): Buffer | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) return null;
  const boundary = `--${(boundaryMatch[1] ?? boundaryMatch[2]).trim()}`;
  const separator = Buffer.from(`\r\n${boundary}`, 'latin1');

  const start = body.indexOf(Buffer.from(boundary, 'latin1'));
  if (start < 0) return null;

  let cursor = start + boundary.length;
  for (;;) {
    if (body.slice(cursor, cursor + 2).toString('latin1') === '--') return null;
    const headerEnd = body.indexOf('\r\n\r\n', cursor);
    if (headerEnd < 0) return null;
    const headers = body.slice(cursor, headerEnd).toString('latin1');
    const bodyStart = headerEnd + 4;
    const next = body.indexOf(separator, bodyStart);
    if (next < 0) return null;
    if (/name="file"/i.test(headers)) return body.slice(bodyStart, next);
    cursor = next + separator.length;
  }
}
