/** A small multipart/form-data reader for the one upload endpoint. */
interface Part {
  name: string;
  filename: string | null;
  contentType: string;
  data: Buffer;
}

export function parseMultipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: Part[] = [];
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    if (split >= 0) {
      const headers = chunk.subarray(0, split).toString("utf8");
      const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
      if (name !== undefined) parts.push({ name, filename, contentType: type, data: chunk.subarray(split + 4) });
    }
    cursor = next;
  }
  return parts;
}
