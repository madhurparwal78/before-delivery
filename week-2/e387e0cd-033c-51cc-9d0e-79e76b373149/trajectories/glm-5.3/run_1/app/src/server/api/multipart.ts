// Multipart/form-data parsing for the data request page answer.
export interface Part { name: string; filename: string | null; contentType: string; data: Buffer }

export function parseMultipart(body: Buffer, contentType: string): Part[] | null {
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  if (match === null) return null;
  const boundary = `--${match[1]}`;
  const parts: Part[] = [];
  const boundaryBuf = Buffer.from(boundary);
  let start = body.indexOf(boundaryBuf);
  if (start < 0) return null;
  start += boundaryBuf.length;
  while (true) {
    if (start + 2 > body.length) break;
    const sep = body.slice(start, start + 2).toString();
    if (sep === '--') break;
    if (sep === '\r\n') start += 2;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) return null;
    const headerText = body.slice(start, headerEnd).toString('utf8');
    const nextBoundary = body.indexOf(boundaryBuf, headerEnd + 4);
    if (nextBoundary < 0) return null;
    let dataEnd = nextBoundary - 2;
    if (body.slice(nextBoundary - 4, nextBoundary - 2).toString() === '\r\n') dataEnd = nextBoundary - 4;
    const data = body.slice(headerEnd + 4, dataEnd);
    const headers: Record<string, string> = {};
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    const disposition = headers['content-disposition'] ?? '';
    const nameMatch = disposition.match(/name="([^"]*)"/i);
    const fileMatch = disposition.match(/filename="([^"]*)"/i);
    if (nameMatch === null) return null;
    parts.push({ name: nameMatch[1], filename: fileMatch !== null ? fileMatch[1] : null, contentType: headers['content-type'] ?? '', data });
    start = nextBoundary + boundaryBuf.length;
    if (start + 2 > body.length) break;
    const closing = body.slice(start, start + 2).toString();
    if (closing === '--') break;
  }
  return parts;
}
