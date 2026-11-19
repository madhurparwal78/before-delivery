// A small multipart/form-data reader for the photo endpoints (bodies are capped at 5,100,000 bytes).

export interface UploadedFile {
  contentType: string;
  data: Buffer;
}

export interface Multipart {
  fields: Record<string, string>;
  files: Record<string, UploadedFile>;
}

export function parseMultipart(body: Buffer, contentTypeHeader: string): Multipart {
  const result: Multipart = { fields: {}, files: {} };
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  const boundaryText = match?.[1] ?? match?.[2];
  if (!boundaryText) return result;
  const boundary = Buffer.from(`--${boundaryText.trim()}`);
  let start = body.indexOf(boundary);
  while (start !== -1) {
    const partStart = start + boundary.length;
    if (body.subarray(partStart, partStart + 2).toString() === "--") break;
    const next = body.indexOf(boundary, partStart);
    if (next === -1) break;
    // Each part: CRLF, headers, blank line, content, CRLF before the next boundary.
    const part = body.subarray(partStart + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const headers = part.subarray(0, split).toString("utf8");
      const content = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(headers)?.[1];
      const isFile = /filename="/i.test(headers);
      const type = /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim().toLowerCase() ?? "";
      if (name !== undefined) {
        if (isFile) result.files[name] = { contentType: type, data: Buffer.from(content) };
        else result.fields[name] = content.toString("utf8");
      }
    }
    start = next;
  }
  return result;
}
