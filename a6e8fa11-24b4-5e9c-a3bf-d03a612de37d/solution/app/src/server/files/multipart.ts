// multipart/form-data, read from a body already capped at the import request limit.

export interface Part {
  name: string;
  filename: string | null;
  data: Buffer;
}

export function parseMultipart(body: Buffer, contentType: string | undefined): Part[] | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? "");
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: Part[] = [];
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const chunk = body.subarray(start + 2, next - 2); // skip the CRLF after the delimiter and before the next one
    const split = chunk.indexOf("\r\n\r\n");
    if (split >= 0) {
      const head = chunk.subarray(0, split).toString("utf8");
      const disposition = /content-disposition:[^\r\n]*/i.exec(head)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
      if (name !== undefined) parts.push({ name, filename, data: chunk.subarray(split + 4) });
    }
    at = next;
  }
  return parts;
}
