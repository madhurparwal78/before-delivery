export interface UploadedFile {
  field: string;
  bytes: Buffer;
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : value.trim();
}

function fieldNameOf(headerBlock: string): string | null {
  const match = /name="([^"]*)"/i.exec(headerBlock);
  return match?.[1] ?? null;
}

/** The file parts of a multipart/form-data body, keyed by their field names. */
export function parseMultipart(body: Buffer, contentType: string): UploadedFile[] {
  const boundary = boundaryOf(contentType);
  if (boundary === null) return [];
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  const parts: UploadedFile[] = [];
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const section = body.subarray(start, next);
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerBlock = section.subarray(0, headerEnd).toString('latin1');
      const field = fieldNameOf(headerBlock);
      if (field !== null) {
        let end = next - start;
        if (section.subarray(end - 2, end).toString('latin1') === '\r\n') end -= 2;
        parts.push({ field, bytes: Buffer.from(section.subarray(headerEnd + 4, end)) });
      }
    }
    cursor = next;
  }
  return parts;
}
