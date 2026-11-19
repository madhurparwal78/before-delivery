interface FilePart {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface MultipartForm {
  fields: Map<string, string>;
  file: FilePart | null;
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

export function parseMultipart(body: Buffer, contentType: string): MultipartForm | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const form: MultipartForm = { fields: new Map(), file: null };
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) return null;
  for (;;) {
    cursor += delimiter.length;
    if (body.subarray(cursor, cursor + 2).toString() === "--") return form;
    cursor += 2;
    const headerEnd = body.indexOf("\r\n\r\n", cursor);
    if (headerEnd < 0) return null;
    const headers = body.subarray(cursor, headerEnd).toString("utf8");
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headerEnd + 4);
    if (next < 0) return null;
    const content = body.subarray(headerEnd + 4, next);
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (name !== undefined && filename !== undefined) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
      if (name === "file") form.file = { filename, contentType: type, bytes: Buffer.from(content) };
    } else if (name !== undefined) {
      form.fields.set(name, content.toString("utf8"));
    }
    cursor = next + 2;
  }
}
