/**
 * Attachment content judgement and filename rules (DP-47). The extension
 * decides the accepted kind and the bytes must then match it.
 */

export const ALLOWED_EXTENSIONS = ["txt", "vtt", "pdf", "png", "jpg", "jpeg"] as const;

export const MAX_ATTACHMENT_BYTES = 10_000_000;

export interface AttachmentKind {
  ext: string;
  contentType: string;
}

/** The canonical content type for an extension, or null when unsupported. */
export function kindForExtension(filename: string): AttachmentKind | null {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = lower.slice(dot + 1);
  switch (ext) {
    case "txt":
      return { ext: ".txt", contentType: "text/plain; charset=utf-8" };
    case "vtt":
      return { ext: ".vtt", contentType: "text/vtt; charset=utf-8" };
    case "pdf":
      return { ext: ".pdf", contentType: "application/pdf" };
    case "png":
      return { ext: ".png", contentType: "image/png" };
    case "jpg":
    case "jpeg":
      return { ext: ".jpg", contentType: "image/jpeg" };
    default:
      return null;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BOM = [0xef, 0xbb, 0xbf];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === 0x00) return false;
    if (b < 0x80) {
      i++;
      continue;
    }
    let seqLen: number;
    let minCodePoint: number;
    if (b >= 0xc2 && b <= 0xdf) {
      seqLen = 2;
      minCodePoint = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      seqLen = 3;
      minCodePoint = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      seqLen = 4;
      minCodePoint = 0x10000;
    } else {
      return false;
    }
    if (i + seqLen > bytes.length) return false;
    let codePoint = b & (seqLen === 2 ? 0x1f : seqLen === 3 ? 0x0f : 0x07);
    for (let j = 1; j < seqLen; j++) {
      const cont = bytes[i + j]!;
      if ((cont & 0xc0) !== 0x80) return false;
      codePoint = (codePoint << 6) | (cont & 0x3f);
    }
    if (codePoint < minCodePoint) return false;
    if (codePoint > 0x10ffff) return false;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
    i += seqLen;
  }
  return true;
}

/** True when the bytes match the extension's expected kind (DP-47). */
export function bytesMatchKind(bytes: Uint8Array, ext: string): boolean {
  switch (ext) {
    case ".png":
      return startsWith(bytes, PNG_SIGNATURE);
    case ".jpg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case ".pdf": {
      const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 5));
      return head === "%PDF-";
    }
    case ".txt":
      return isValidUtf8(bytes) && !bytes.includes(0x00);
    case ".vtt": {
      if (!isValidUtf8(bytes) || bytes.includes(0x00)) return false;
      let start = 0;
      if (startsWith(bytes, BOM)) start = BOM.length;
      const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(start, start + 6));
      if (head !== "WEBVTT") return false;
      const after = bytes[start + 6];
      if (after === undefined) return true;
      return after === 0x20 || after === 0x09 || after === 0x0a || after === 0x0d;
    }
    default:
      return false;
  }
}

/**
 * The display filename: last path segment, Unicode NFC, base cut to keep the
 * whole name at most 120 characters with the extension kept, `file` for an
 * empty base.
 */
export function displayFilename(raw: string): string {
  let name = raw;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  if (slash !== -1) name = name.slice(slash + 1);
  name = name.normalize("NFC");
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot);
  if (name.length <= 120) return name.length === 0 || name === ext ? `file${ext}` : name;
  if (ext.length >= 120) {
    const cut = name.slice(0, 120 - ext.length) + ext;
    return cut;
  }
  let base = name.slice(0, dot);
  const keep = Math.max(0, 120 - ext.length);
  base = base.slice(0, keep);
  if (base.length === 0) return `file${ext}`;
  return base + ext;
}

/** The storage key name part: every character outside the safe set is a dash. */
export function safeStorageName(name: string): string {
  let out = "";
  for (const ch of name) {
    if (/[A-Za-z0-9._-]/.test(ch)) {
      out += ch;
    } else {
      out += "-";
    }
  }
  return out;
}

/** The Content-Disposition filename pair for a display filename (DP-47). */
export function contentDispositionFilename(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
