// Upload type detection by leading bytes, and the safe stored filename.
// The single home of both rules.

export const UPLOAD_MAX_BYTES = 10000000;
export const UPLOAD_MAX_REQUEST = 10100000;
export const UPLOAD_WRONG_TYPE_MESSAGE = "Attach an image (PNG, JPEG, GIF, WebP) or a PDF.";

/** Detect the content type from leading bytes; null when unrecognized. */
export function sniffType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "image/gif";
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "application/pdf";
  }
  return null;
}

/** Reduce an upload filename to the safe stored base name. */
export function safeFilename(name: string): string {
  let s = name;
  const slash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  if (slash !== -1) s = s.slice(slash + 1);
  // remove control characters
  s = s.replace(/[\u0000-\u001f\u007f]/g, "");
  s = s.trim();
  if (s.length > 200) s = s.slice(0, 200);
  if (s.length === 0 || s === "." || s === "..") s = "attachment";
  return s;
}
