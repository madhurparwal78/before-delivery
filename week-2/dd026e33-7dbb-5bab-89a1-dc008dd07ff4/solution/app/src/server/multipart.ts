// multipart/form-data parsing of a fully received upload body (at most 10 MB).

export interface UploadedFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface FormData {
  fields: Record<string, string>;
  file: UploadedFile | null;
}

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match?.[1] ?? match?.[2] ?? null;
}

function headerValue(headers: string, name: string): string | null {
  for (const line of headers.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0 && line.slice(0, colon).trim().toLowerCase() === name) return line.slice(colon + 1).trim();
  }
  return null;
}

function parameter(header: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`, "i").exec(header) ?? new RegExp(`${name}=([^;\\s]+)`, "i").exec(header);
  return match?.[1] ?? null;
}

/** Splits the body into its named fields and its `file` part; malformed parts are skipped. */
export function parseForm(body: Buffer, boundary: string): FormData {
  const delimiter = Buffer.from(`--${boundary}`);
  const form: FormData = { fields: {}, file: null };
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    let partStart = start + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString() === "--") break;
    if (body.subarray(partStart, partStart + 2).toString() === "\r\n") partStart += 2;
    const next = body.indexOf(delimiter, partStart);
    if (next < 0) break;
    const part = body.subarray(partStart, next - 2); // strip the CRLF before the delimiter
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const headers = part.subarray(0, split).toString("utf8");
      const content = part.subarray(split + 4);
      const disposition = headerValue(headers, "content-disposition") ?? "";
      const name = parameter(disposition, "name");
      const filename = parameter(disposition, "filename");
      if (name === "file" && filename !== null) {
        form.file = { filename, contentType: headerValue(headers, "content-type") ?? "application/octet-stream", data: Buffer.from(content) };
      } else if (name !== null) {
        form.fields[name] = content.toString("utf8");
      }
    }
    start = next;
  }
  return form;
}
