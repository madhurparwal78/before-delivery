export interface UploadedFile {
  field: string;
  filename: string;
  data: Uint8Array;
}

const dash = 0x2d;

/** Minimal multipart/form-data reader for one-file uploads. */
export async function readMultipart(req: import("node:http").IncomingMessage, limitBytes: number): Promise<UploadedFile[]> {
  const contentType = String(req.headers["content-type"] ?? "");
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return [];
  const boundary = "--" + (match[1] ?? match[2]).trim();
  const boundaryBytes = new TextEncoder().encode(boundary);
  const chunks: Buffer[] = [];
  let size = 0;
  const raw = await new Promise<Buffer | null>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("file_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.concat(chunks)));
  });
  if (!raw) return [];
  const files: UploadedFile[] = [];
  let position = findSequence(raw, boundaryBytes, 0);
  if (position === -1) return [];
  position += boundaryBytes.length;
  while (position < raw.length) {
    // Skip CRLF after the boundary.
    if (raw[position] === 0x0d && raw[position + 1] === 0x0a) position += 2;
    // A closing boundary ends the form.
    if (raw[position] === dash && raw[position + 1] === dash) break;
    // Read the part headers up to the blank line.
    const headerEnd = raw.indexOf("\r\n\r\n", position);
    if (headerEnd === -1) break;
    const headerText = raw.subarray(position, headerEnd).toString("utf8");
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText)?.[1] ?? "";
    const field = /name="([^"]*)"/i.exec(disposition)?.[1] ?? "";
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? "";
    let bodyStart = headerEnd + 4;
    const nextBoundary = findSequence(raw, boundaryBytes, bodyStart);
    if (nextBoundary === -1) break;
    let bodyEnd = nextBoundary;
    if (raw[bodyEnd - 2] === 0x0d && raw[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    if (filename !== "") {
      files.push({ field, filename, data: new Uint8Array(raw.subarray(bodyStart, bodyEnd)) });
    }
    position = nextBoundary + boundaryBytes.length;
    void bodyEnd;
  }
  return files;
}

function findSequence(haystack: Buffer, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
