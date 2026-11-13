export type MultipartFile = { field: string; filename: string; contentType: string; data: Buffer };
export type Multipart = { fields: Record<string, string>; files: MultipartFile[] };

function headerValue(headers: string, name: string): string | undefined {
  const line = headers.split("\r\n").find((entry) => entry.toLowerCase().startsWith(`${name}:`));
  return line ? line.slice(name.length + 1).trim() : undefined;
}

function disposition(value: string, key: string): string | undefined {
  const match = new RegExp(`${key}="([^"]*)"`, "i").exec(value);
  return match ? match[1] : undefined;
}

export function boundaryOf(contentType: string | undefined): string | undefined {
  const match = contentType ? /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType) : null;
  return match ? (match[1] ?? match[2]) : undefined;
}

export function parseMultipart(body: Buffer, boundary: string): Multipart {
  const delimiter = Buffer.from(`--${boundary}`);
  const result: Multipart = { fields: {}, files: [] };
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const part = body.subarray(start + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = part.subarray(0, split).toString("utf8");
      const data = part.subarray(split + 4);
      const dispositionLine = headerValue(head, "content-disposition") ?? "";
      const field = disposition(dispositionLine, "name") ?? "";
      const filename = disposition(dispositionLine, "filename");
      if (filename !== undefined) {
        result.files.push({ field, filename, contentType: headerValue(head, "content-type") ?? "", data: Buffer.from(data) });
      } else {
        result.fields[field] = data.toString("utf8");
      }
    }
    cursor = next;
  }
  return result;
}
