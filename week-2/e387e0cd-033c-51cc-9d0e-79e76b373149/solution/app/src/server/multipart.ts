// A bounded multipart/form-data reader for the request page answer (fields and one file).

interface Part {
  name: string;
  filename: string | null;
  data: Buffer;
}

/** The parts of a multipart body, or null when the body can't be read as multipart. */
export function parseMultipart(body: Buffer, contentType: string): Part[] | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: Part[] = [];
  let at = body.indexOf(delimiter);
  if (at < 0) return null;
  for (;;) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") return parts;
    if (body.subarray(start, start + 2).toString() !== "\r\n") return null;
    const next = body.indexOf(delimiter, start);
    if (next < 0) return null;
    const section = body.subarray(start + 2, next - 2);
    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd < 0) return null;
    const headers = section.subarray(0, headerEnd).toString("utf8");
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headers);
    if (!disposition) return null;
    const name = /\bname="([^"]*)"/i.exec(disposition[1]);
    const filename = /\bfilename="([^"]*)"/i.exec(disposition[1]);
    if (!name) return null;
    parts.push({ name: name[1], filename: filename ? filename[1] : null, data: Buffer.from(section.subarray(headerEnd + 4)) });
    at = next;
  }
}
