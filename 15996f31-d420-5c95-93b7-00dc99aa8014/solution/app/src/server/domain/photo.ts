// Frame photo checks (brief: Server boundary → Photo checks): the type is decided from the leading bytes only.

interface PhotoType {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

export const PHOTO_LIMIT = 8_000_000;
export const PHOTOS_PER_SAMPLE = 4;

export function sniffPhoto(bytes: Buffer): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

/** The bytes of the first file part named `field` in a multipart/form-data body, or null when there is none. */
export function multipartFile(body: Buffer, contentType: string, field: string): Buffer | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const headersStart = cursor + delimiter.length + 2;
    const headersEnd = body.indexOf("\r\n\r\n", headersStart);
    if (headersEnd === -1) return null;
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headersEnd + 4);
    if (next === -1) return null;
    const headers = body.toString("utf8", headersStart, headersEnd);
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
    if (new RegExp(`\\bname="${field}"`).test(disposition) && /\bfilename=/i.test(disposition)) return body.subarray(headersEnd + 4, next);
    cursor = next + 2;
  }
  return null;
}
