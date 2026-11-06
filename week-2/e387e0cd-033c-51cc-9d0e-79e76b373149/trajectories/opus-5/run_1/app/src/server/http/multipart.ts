/** The multipart/form-data reading the data request page answer needs. */

export interface FilePart {
  readonly fieldName: string;
  readonly fileName: string;
  readonly bytes: Buffer;
}

export interface MultipartForm {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: readonly FilePart[];
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (match === null) return null;
  return (match[1] ?? match[2]).trim();
}

function headerLines(block: Buffer): { headers: string[]; bodyStart: number } | null {
  const split = block.indexOf('\r\n\r\n');
  if (split === -1) return null;
  return {
    headers: block.subarray(0, split).toString('utf8').split('\r\n'),
    bodyStart: split + 4,
  };
}

export function readMultipart(contentType: string, body: Buffer): MultipartForm | null {
  const boundary = boundaryOf(contentType);
  if (boundary === null) return null;
  const marker = Buffer.from(`--${boundary}`, 'utf8');
  const fields: Record<string, string> = {};
  const files: FilePart[] = [];
  let at = body.indexOf(marker);
  if (at === -1) return null;
  at += marker.length;
  let guard = 0;
  while (at < body.length && guard < 200) {
    guard += 1;
    if (body.toString('latin1', at, at + 2) === '--') break;
    if (body.toString('latin1', at, at + 2) !== '\r\n') return null;
    at += 2;
    const next = body.indexOf(marker, at);
    if (next === -1) return null;
    const block = body.subarray(at, next - 2);
    const parsed = headerLines(block);
    if (parsed === null) return null;
    const disposition = parsed.headers.find((line) =>
      line.toLowerCase().startsWith('content-disposition:'),
    );
    if (disposition === undefined) return null;
    const nameMatch = /name="([^"]*)"/.exec(disposition);
    if (nameMatch === null) return null;
    const fileNameMatch = /filename="([^"]*)"/.exec(disposition);
    const value = block.subarray(parsed.bodyStart);
    if (fileNameMatch === null) {
      fields[nameMatch[1]] = value.toString('utf8');
    } else {
      files.push({
        fieldName: nameMatch[1],
        fileName: fileNameMatch[1],
        bytes: Buffer.from(value),
      });
    }
    at = next + marker.length;
  }
  return { fields, files };
}
