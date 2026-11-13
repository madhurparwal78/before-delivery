export interface UploadedFile {
  filename: string;
  bytes: Buffer;
}

function boundaryOf(contentType: string | undefined): string | null {
  if (contentType === undefined) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (match === null) return null;
  return (match[1] ?? match[2]).trim();
}

function parseDisposition(header: string): { name: string | null; filename: string | null } {
  const name = /;\s*name="([^"]*)"/i.exec(header);
  const filename = /;\s*filename="((?:[^"\\]|\\.)*)"/i.exec(header);
  return {
    name: name === null ? null : name[1],
    filename: filename === null ? null : filename[1].replace(/\\(.)/g, '$1'),
  };
}

/** Reads the one `file` part of a multipart body. The stored name is its last path segment. */
export function readFilePart(body: Buffer, contentType: string | undefined, field: string): UploadedFile | null {
  const boundary = boundaryOf(contentType);
  if (boundary === null) return null;
  const marker = Buffer.from(`--${boundary}`, 'utf8');
  const parts: Buffer[] = [];
  let index = body.indexOf(marker);
  while (index >= 0) {
    const start = index + marker.byteLength;
    const next = body.indexOf(marker, start);
    if (next < 0) break;
    parts.push(body.subarray(start, next));
    index = next;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const disposition = headerText
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-disposition:'));
    if (disposition === undefined) continue;
    const { name, filename } = parseDisposition(disposition);
    if (name !== field) continue;
    let bytes = part.subarray(headerEnd + 4);
    if (bytes.subarray(-2).toString('latin1') === '\r\n') bytes = bytes.subarray(0, bytes.byteLength - 2);
    const lastSegment = (filename ?? 'price-sheet.csv').split(/[/\\]/).pop() ?? 'price-sheet.csv';
    return { filename: lastSegment === '' ? 'price-sheet.csv' : lastSegment, bytes };
  }
  return null;
}
