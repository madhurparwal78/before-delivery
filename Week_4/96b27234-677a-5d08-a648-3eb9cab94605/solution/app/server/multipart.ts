export interface Upload {
  fields: Map<string, string>;
  file: { name: string; data: Buffer } | null;
}

/** Reads a multipart/form-data body: text fields by name and the one `file` part, byte for byte. */
export function parseMultipart(raw: Buffer, contentType: string): Upload {
  const upload: Upload = { fields: new Map(), file: null };
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) return upload;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2] ?? ""}`);
  let at = raw.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (raw.subarray(start, start + 2).toString() === "--") break;
    const next = raw.indexOf(delimiter, start);
    if (next < 0) break;
    const part = raw.subarray(start + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const head = part.subarray(0, split).toString("utf8");
      const body = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      if (name === "file" && filename !== undefined) upload.file = { name: filename, data: Buffer.from(body) };
      else if (name !== undefined && filename === undefined) upload.fields.set(name, body.toString("utf8"));
    }
    at = next;
  }
  return upload;
}
