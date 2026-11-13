export interface FilePart {
  filename: string;
  data: Buffer;
}

/** The `file` part of a multipart/form-data body, or null when the body has none. */
export function parseFilePart(body: Buffer, contentType: string): FilePart | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const headerStart = at + delimiter.length;
    if (body.subarray(headerStart, headerStart + 2).toString() === "--") return null;
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) return null;
    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
    if (next === -1) return null;
    const disposition = /^content-disposition:[^\r\n]*$/im.exec(headers)?.[0] ?? "";
    if (/\bname="file"/i.test(disposition)) {
      const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? "";
      return { filename, data: body.subarray(headerEnd + 4, next) };
    }
    at = body.indexOf(delimiter, next);
  }
  return null;
}
