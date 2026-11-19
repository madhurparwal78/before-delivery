/**
 * A byte-exact multipart/form-data parser. The file part is kept as raw bytes,
 * with NUL, CR and LF included, and the framing around it is never kept.
 */
export interface MultipartFilePart {
  name: string;
  filename: string | null;
  contentType: string | null;
  bytes: Buffer;
}

export interface MultipartFieldPart {
  name: string;
  value: string;
}

export interface MultipartResult {
  fields: MultipartFieldPart[];
  files: MultipartFilePart[];
}

export function parseMultipart(body: Buffer, contentType: string): MultipartResult {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) return { fields: [], files: [] };
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2] ?? '').trim();
  if (boundary === '') return { fields: [], files: [] };
  const delimiter = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from('\r\n');
  const fields: MultipartFieldPart[] = [];
  const files: MultipartFilePart[] = [];

  let position = indexOf(body, delimiter, 0);
  while (position !== -1) {
    let partStart = position + delimiter.length;
    if (partStart + 2 > body.length) break;
    const after = body.slice(partStart, partStart + 2);
    if (after.equals(Buffer.from('--'))) break;
    if (after.equals(crlf)) partStart += 2;
    const headerEnd = indexOf(body, Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd === -1) break;
    const headerText = body.slice(partStart, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextDelimiter = indexOf(body, Buffer.from(`\r\n--${boundary}`), bodyStart);
    if (nextDelimiter === -1) break;
    const partBytes = body.slice(bodyStart, nextDelimiter);

    const headers: Record<string, string> = {};
    for (const line of headerText.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const disposition = headers['content-disposition'] ?? '';
    const name = paramOf(disposition, 'name');
    const filename = paramOfRaw(disposition, 'filename');
    if (filename !== null) {
      files.push({
        name,
        filename,
        contentType: headers['content-type'] ?? null,
        bytes: partBytes,
      });
    } else {
      fields.push({ name, value: partBytes.toString('utf8') });
    }
    position = nextDelimiter + 2 + boundary.length;
  }
  return { fields, files };
}

function indexOf(haystack: Buffer, needle: Buffer, from: number): number {
  return haystack.indexOf(needle, from);
}

function paramOf(disposition: string, param: string): string {
  const match = new RegExp(`${param}="([^"]*)"`, 'i').exec(disposition);
  if (match) return match[1];
  const loose = new RegExp(`${param}=([^;\\s]+)`, 'i').exec(disposition);
  return loose ? loose[1] : '';
}

/** The filename parameter, kept raw so percent sequences and NULs survive display handling. */
function paramOfRaw(disposition: string, param: string): string | null {
  const match = new RegExp(`${param}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(disposition);
  if (match) return match[1];
  const loose = new RegExp(`${param}=([^;\\s]+)`, 'i').exec(disposition);
  return loose ? loose[1] : null;
}

/** The display file name: last path segment, safe characters only, at most 120 characters. */
export function displayName(filename: string | null): string {
  if (filename === null) return 'file';
  const segment = filename.split(/[\\/]/).pop() ?? '';
  let safe = '';
  for (const char of segment) {
    safe += /[A-Za-z0-9._-]/.test(char) ? char : '_';
  }
  safe = safe.slice(0, 120);
  return safe === '' ? 'file' : safe;
}
