/**
 * Reads the one file part the cover upload sends. Cover upload is the only
 * multipart endpoint, so this handles exactly that shape.
 */

export interface FilePart {
  filename: string;
  contentType: string;
  content: Buffer;
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value ? value.trim() : null;
}

export function parseSingleFilePart(body: Buffer, contentType: string, fieldName: string): FilePart | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;

  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let cursor = body.indexOf(delimiter);
  if (cursor === -1) return null;

  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString("latin1") === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    // Each part begins after the delimiter's CRLF and ends before the next CRLF.
    parts.push(body.subarray(start + 2, next - 2));
    cursor = next;
  }

  for (const part of parts) {
    const separator = part.indexOf("\r\n\r\n");
    if (separator === -1) continue;
    const headerText = part.subarray(0, separator).toString("utf8");
    const content = part.subarray(separator + 4);

    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? "";
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    if (name !== fieldName) continue;

    return {
      filename: /filename="([^"]*)"/i.exec(disposition)?.[1] ?? "upload",
      contentType: (/content-type:\s*([^\r\n;]+)/i.exec(headerText)?.[1] ?? "application/octet-stream").trim(),
      content,
    };
  }
  return null;
}
