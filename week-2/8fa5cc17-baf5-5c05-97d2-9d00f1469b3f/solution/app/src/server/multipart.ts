// Reads the one `file` part of a multipart/form-data upload.

export interface FilePart { filename: string; contentType: string; bytes: Buffer }

function boundaryOf(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2]).trim() : null;
}

function headerParam(headerValue: string, name: string): string | null {
  // Browsers and HTTP clients send backslashes in filenames as they are, so the quoted value is taken raw.
  const m = new RegExp(`(?:^|;)\\s*${name}=(?:"([^"]*)"|([^;]+))`, 'i').exec(headerValue);
  if (!m) return null;
  return m[1] !== undefined ? m[1] : m[2].trim();
}

/** The `file` part, or null when the body has none. */
export function filePart(body: Buffer, contentType: string): FilePart | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length + 2; // skip CRLF after the delimiter
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) return null;
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (next === -1) return null;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? '';
    if (headerParam(disposition, 'name') === 'file') {
      return {
        filename: headerParam(disposition, 'filename') ?? '',
        contentType: (/content-type:([^\r\n]*)/i.exec(headers)?.[1] ?? '').split(';')[0].trim().toLowerCase(),
        bytes: body.subarray(headerEnd + 4, next - 2), // drop the CRLF before the next delimiter
      };
    }
    start = next;
  }
  return null;
}
