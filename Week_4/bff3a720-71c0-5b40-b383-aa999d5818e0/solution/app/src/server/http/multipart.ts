interface FilePart {
  filename: string;
  data: Buffer;
}

/** The one `file` part of a multipart/form-data body, or undefined when there is none. */
export function filePart(body: Buffer, contentType: string): FilePart | undefined {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) return undefined;
  const delimiter = Buffer.from(`--${marker}`);
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    const headStart = cursor + delimiter.length;
    if (body.subarray(headStart, headStart + 2).toString() === "--") return undefined;
    const headEnd = body.indexOf("\r\n\r\n", headStart);
    if (headEnd < 0) return undefined;
    const head = body.subarray(headStart, headEnd).toString("latin1");
    const next = body.indexOf(delimiter, headEnd + 4);
    const dataEnd = next < 0 ? body.length : next - 2;
    if (/name="file"/i.test(head)) {
      const name = /filename="([^"]*)"/i.exec(head)?.[1] ?? "";
      return { filename: name, data: body.subarray(headEnd + 4, Math.max(headEnd + 4, dataEnd)) };
    }
    cursor = next;
  }
  return undefined;
}
