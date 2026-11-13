// A small multipart/form-data reader: one file part named `file` and plain text fields.
export interface UploadedFile {
  name: string;
  content: Buffer;
}

interface MultipartParts {
  file: UploadedFile | null;
  fields: Record<string, string>;
}

export function readMultipart(body: Buffer, contentTypeHeader: string): MultipartParts {
  const parsed: MultipartParts = { file: null, fields: {} };
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  const token = boundary?.[1] ?? boundary?.[2];
  if (!token) return parsed;
  const delimiter = Buffer.from(`--${token}`);
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const part = body.subarray(start + 2, next - 2);
    cursor = next;
    const split = part.indexOf("\r\n\r\n");
    if (split === -1) continue;
    const headers = part.subarray(0, split).toString("utf8");
    const content = part.subarray(split + 4);
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (name === "file" && filename !== undefined) {
      parsed.file = { name: filename.split(/[\\/]/).pop() ?? filename, content: Buffer.from(content) };
    } else if (name) {
      parsed.fields[name] = content.toString("utf8");
    }
  }
  return parsed;
}
