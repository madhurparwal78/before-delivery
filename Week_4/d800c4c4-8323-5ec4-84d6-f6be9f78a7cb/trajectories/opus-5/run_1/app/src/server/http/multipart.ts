export interface UploadedFile {
  readonly filename: string;
  readonly contentType: string;
  readonly data: Buffer;
}

export interface MultipartBody {
  readonly fields: Map<string, string>;
  readonly files: Map<string, UploadedFile>;
}

const CRLF = Buffer.from('\r\n');

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value ? value.trim() : null;
}

function parseDisposition(header: string): { name: string | null; filename: string | null } {
  const name = /;\s*name="([^"]*)"/i.exec(header);
  const filename = /;\s*filename="([^"]*)"/i.exec(header);
  return { name: name?.[1] ?? null, filename: filename?.[1] ?? null };
}

/** Splits a multipart/form-data body into its text fields and file parts. */
export function parseMultipart(body: Buffer, contentType: string): MultipartBody | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  const files = new Map<string, UploadedFile>();

  let cursor = body.indexOf(delimiter);
  if (cursor < 0) return null;
  cursor += delimiter.length;

  for (;;) {
    if (body.subarray(cursor, cursor + 2).toString() === '--') return { fields, files };
    const headerStart = cursor + CRLF.length;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd < 0) return { fields, files };
    const headerText = body.subarray(headerStart, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextDelimiter = body.indexOf(delimiter, bodyStart);
    if (nextDelimiter < 0) return { fields, files };
    const partBody = body.subarray(bodyStart, nextDelimiter - CRLF.length);

    let disposition = '';
    let partContentType = 'application/octet-stream';
    for (const line of headerText.split('\r\n')) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const name = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (name === 'content-disposition') disposition = value;
      if (name === 'content-type') partContentType = value;
    }
    const { name, filename } = parseDisposition(disposition);
    if (name !== null) {
      if (filename === null) {
        fields.set(name, partBody.toString('utf8'));
      } else {
        files.set(name, {
          filename,
          contentType: partContentType.split(';')[0]?.trim() ?? partContentType,
          data: Buffer.from(partBody),
        });
      }
    }
    cursor = nextDelimiter + delimiter.length;
  }
}
