// A multipart/form-data reader over an already size-limited body.

export interface FilePart {
  filename: string;
  content: Buffer;
}

export interface MultipartForm {
  fields: Record<string, string>;
  files: Record<string, FilePart>;
}

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? "").trim() : null;
}

export function parseMultipart(body: Buffer, boundary: string): MultipartForm | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const form: MultipartForm = { fields: {}, files: {} };
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) return null;
  while (true) {
    cursor += delimiter.length;
    if (body.subarray(cursor, cursor + 2).toString() === "--") return form;
    cursor += 2; // CRLF after the delimiter
    const headerEnd = body.indexOf("\r\n\r\n", cursor);
    if (headerEnd < 0) return null;
    const headers = body.subarray(cursor, headerEnd).toString("utf8");
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headerEnd + 4);
    if (next < 0) return null;
    const content = body.subarray(headerEnd + 4, next);
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
    if (name !== undefined) {
      if (filename !== undefined) form.files[name] = { filename, content: Buffer.from(content) };
      else form.fields[name] = content.toString("utf8");
    }
    cursor = next + 2;
  }
}
