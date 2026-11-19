// A small multipart/form-data reader for the one upload endpoint.

interface UploadedFile {
  field: string;
  fileName: string;
  /** The part's declared Content-Type, lower case and without parameters. */
  declaredType: string;
  data: Buffer;
}

export interface Multipart {
  fields: Map<string, string>;
  files: UploadedFile[];
  /** Form fields sent more than once. */
  repeated: string[];
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function headerParam(header: string, name: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${name}="([^"]*)"`, "i").exec(header) ?? new RegExp(`(?:^|;)\\s*${name}=([^;\\s]+)`, "i").exec(header);
  return match ? (match[1] ?? null) : null;
}

/** Returns null when the body is not well-formed multipart. */
export function parseMultipart(body: Buffer, contentType: string): Multipart | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const result: Multipart = { fields: new Map(), files: [], repeated: [] };
  let position = body.indexOf(delimiter);
  if (position < 0) return null;
  for (;;) {
    position += delimiter.length;
    if (body.subarray(position, position + 2).toString() === "--") return result;
    if (body.subarray(position, position + 2).toString() !== "\r\n") return null;
    const headersEnd = body.indexOf("\r\n\r\n", position);
    if (headersEnd < 0) return null;
    const headers = body.subarray(position + 2, headersEnd).toString("utf8");
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headersEnd + 4);
    if (next < 0) return null;
    const data = body.subarray(headersEnd + 4, next);
    const disposition = headers.split("\r\n").find((line) => line.toLowerCase().startsWith("content-disposition:")) ?? "";
    const field = headerParam(disposition.replace(/^content-disposition:\s*/i, ""), "name");
    if (field === null) return null;
    const fileName = headerParam(disposition.replace(/^content-disposition:\s*/i, ""), "filename");
    const typeLine = headers.split("\r\n").find((line) => line.toLowerCase().startsWith("content-type:")) ?? "";
    const declaredType = typeLine.slice("content-type:".length).split(";")[0]?.trim().toLowerCase() ?? "";
    if (result.fields.has(field) || result.files.some((f) => f.field === field)) result.repeated.push(field);
    else if (fileName !== null) result.files.push({ field, fileName, declaredType, data: Buffer.from(data) });
    else result.fields.set(field, data.toString("utf8"));
    position = next + 2;
  }
}
