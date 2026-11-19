export interface UploadedFile {
  field: string;
  filename: string;
  type: string;
  data: Buffer;
}

export interface Multipart {
  fields: Record<string, string>;
  files: UploadedFile[];
}

/** Splits a buffered multipart/form-data body into text fields and files. */
export function parseMultipart(contentType: string, body: Buffer): Multipart | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const result: Multipart = { fields: {}, files: [] };
  let cursor = body.indexOf(marker);
  while (cursor !== -1) {
    const start = cursor + marker.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(marker, start);
    if (next === -1) break;
    const part = body.subarray(start + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = part.subarray(0, split).toString("utf8");
      const data = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1] ?? "";
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? "application/octet-stream";
      if (filename !== undefined) result.files.push({ field: name, filename, type, data });
      else result.fields[name] = data.toString("utf8");
    }
    cursor = next;
  }
  return result;
}
