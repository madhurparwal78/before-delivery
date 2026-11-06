import { ApiError } from "./errors.ts";

export interface UploadedFile {
  filename: string;
  data: Buffer;
  contentType: string | null;
}

/**
 * Parse a multipart/form-data body for the single field named `file`.
 * The upload body limit is the attachment limit plus framing.
 */
export function parseMultipart(raw: Buffer, contentTypeHeader: string): { file?: UploadedFile } {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  if (!m) {
    throw new ApiError("unsupported_media_type", "Send the request as multipart/form-data.");
  }
  const boundary = `--${m[1] ?? m[2]}`;
  const boundaryBuf = Buffer.from(boundary);
  const result: { file?: UploadedFile } = {};
  let idx = raw.indexOf(boundaryBuf);
  while (idx !== -1) {
    const partStart = idx + boundaryBuf.length;
    // Stop at the closing boundary.
    if (raw.slice(partStart, partStart + 2).toString() === "--") break;
    const headerEnd = raw.indexOf("\r\n\r\n", partStart);
    if (headerEnd === -1) break;
    const headerText = raw.slice(partStart, headerEnd).toString("utf8");
    const nextBoundary = raw.indexOf(boundaryBuf, headerEnd + 4);
    if (nextBoundary === -1) break;
    // The part data runs to the CRLF before the boundary.
    let dataEnd = nextBoundary - 2;
    if (dataEnd < headerEnd + 4) dataEnd = headerEnd + 4;
    const data = raw.slice(headerEnd + 4, dataEnd);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    if (nameMatch && nameMatch[1] === "file") {
      result.file = {
        filename: decodeMimeValue(fileMatch?.[1] ?? ""),
        data,
        contentType: typeMatch ? typeMatch[1].trim() : null,
      };
      break;
    }
    idx = nextBoundary;
  }
  return result;
}

/** Decode RFC 5987 or RFC 2231/2047-ish filename values, falling back to the raw text. */
function decodeMimeValue(value: string): string {
  const utf8Star = /utf-8''([^;\s]+)/i.exec(value);
  if (utf8Star) {
    try {
      return decodeURIComponent(utf8Star[1]);
    } catch {
      // fall through
    }
  }
  const percentEncoded = /%[0-9A-Fa-f]{2}/.test(value);
  if (percentEncoded && !value.includes("''")) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return value;
}
