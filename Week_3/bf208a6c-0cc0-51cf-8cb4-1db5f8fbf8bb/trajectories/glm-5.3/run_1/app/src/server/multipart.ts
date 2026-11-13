export function parseMultipart(body: Buffer, contentType: string): { fields: Record<string, string>; file: { fieldName: string; fileName: string; data: Buffer } | null } | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  const boundary = `--${match[1] ?? match[2]}`;
  const boundaryBuffer = Buffer.from(boundary);
  const parts: { headers: Record<string, string>; data: Buffer }[] = [];
  let pos = body.indexOf(boundaryBuffer);
  if (pos === -1) return null;
  pos += boundaryBuffer.length;
  for (;;) {
    if (pos >= body.length) break;
    if (body.slice(pos, pos + 2).toString() === '--') break;
    if (body.slice(pos, pos + 2).toString() === '\r\n') pos += 2;
    const headerEnd = body.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1) break;
    const headerText = body.slice(pos, headerEnd).toString('utf8');
    const headers: Record<string, string> = {};
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundaryBuffer, dataStart);
    if (nextBoundary === -1) break;
    let dataEnd = nextBoundary;
    if (body.slice(dataEnd - 2, dataEnd).toString() === '\r\n') dataEnd -= 2;
    parts.push({ headers, data: body.slice(dataStart, dataEnd) });
    pos = nextBoundary + boundaryBuffer.length;
  }
  const fields: Record<string, string> = {};
  let file: { fieldName: string; fileName: string; data: Buffer } | null = null;
  for (const part of parts) {
    const disposition = part.headers['content-disposition'] ?? '';
    const nameMatch = /name="([^"]*)"/.exec(disposition);
    const fileMatch = /filename="([^"]*)"/.exec(disposition);
    const name = nameMatch?.[1] ?? '';
    if (fileMatch) {
      file = { fieldName: name, fileName: fileMatch[1] ?? '', data: part.data };
    } else {
      fields[name] = part.data.toString('utf8');
    }
  }
  return { fields, file };
}
