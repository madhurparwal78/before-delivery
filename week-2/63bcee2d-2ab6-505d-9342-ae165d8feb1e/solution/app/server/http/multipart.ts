// multipart/form-data over an already size-checked body buffer.

export interface UploadedFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface Multipart {
  fields: Record<string, string>;
  files: Record<string, UploadedFile[]>;
}

export function parseMultipart(body: Buffer, contentType: string): Multipart | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!boundaryMatch) return null;
  const delimiter = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`);
  const result: Multipart = { fields: {}, files: {} };
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) return null;
  while (true) {
    cursor += delimiter.length;
    if (body.subarray(cursor, cursor + 2).toString() === "--") return result;
    cursor += 2; // CRLF after the delimiter
    const headerEnd = body.indexOf("\r\n\r\n", cursor);
    if (headerEnd < 0) return null;
    const headers = body.subarray(cursor, headerEnd).toString("utf8");
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headerEnd + 4);
    if (next < 0) return null;
    const content = body.subarray(headerEnd + 4, next);
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
    if (name !== undefined) {
      if (filename !== undefined) {
        const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
        (result.files[name] ??= []).push({ filename, contentType: type, data: Buffer.from(content) });
      } else {
        result.fields[name] = content.toString("utf8");
      }
    }
    cursor = next + 2;
  }
}
