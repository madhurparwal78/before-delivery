// multipart/form-data from an already size-bounded body.

export interface Part {
  name: string;
  filename: string | null;
  data: Buffer;
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function disposition(headers: string): { name: string; filename: string | null } | null {
  const line = headers.split("\r\n").find((h) => /^content-disposition:/i.test(h));
  if (!line || !/form-data/i.test(line)) return null;
  const name = /;\s*name="([^"]*)"/i.exec(line)?.[1];
  if (name === undefined) return null;
  const filename = /;\s*filename="([^"]*)"/i.exec(line)?.[1] ?? null;
  return { name, filename };
}

/** The parts by name, or null when the body is not well-formed multipart or repeats a name. */
export function parseMultipart(body: Buffer, boundary: string): Map<string, Part> | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = new Map<string, Part>();
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) return null;
  for (;;) {
    cursor += delimiter.length;
    if (body.subarray(cursor, cursor + 2).toString() === "--") return parts;
    if (!body.subarray(cursor, cursor + 2).equals(CRLF)) return null;
    const headerStart = cursor + 2;
    const headerEnd = body.indexOf(HEADER_END, headerStart);
    if (headerEnd < 0) return null;
    const meta = disposition(body.subarray(headerStart, headerEnd).toString("utf8"));
    const dataStart = headerEnd + HEADER_END.length;
    const next = body.indexOf(Buffer.concat([CRLF, delimiter]), dataStart);
    if (!meta || next < 0 || parts.has(meta.name)) return null;
    parts.set(meta.name, { name: meta.name, filename: meta.filename, data: body.subarray(dataStart, next) });
    cursor = next + CRLF.length;
  }
}
