/** The one place upload type detection, filename cleaning and the download header live. */

export type DetectedType = 'image/png' | 'image/jpeg' | 'text/plain';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export function detectType(bytes: Buffer): DetectedType | null {
  if (bytes.length === 0) return null;
  if (bytes.length >= PNG_MAGIC.length && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return 'image/png';
  }
  if (bytes.length >= JPEG_MAGIC.length && bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return 'image/jpeg';
  }
  if (bytes.includes(0x00)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'text/plain';
  } catch {
    return null;
  }
}

export function essenceOf(contentType: string): string {
  const [essence] = contentType.split(';');
  return (essence ?? '').trim().toLowerCase();
}

export function servedContentType(detected: DetectedType): string {
  return detected === 'text/plain' ? 'text/plain; charset=utf-8' : detected;
}

export function storedFilename(submitted: string): string {
  let name = submitted;
  const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSlash !== -1) name = name.slice(lastSlash + 1);
  name = name.replace(/[\u0000-\u001f\u007f"]/g, '');
  name = name.replace(/^ +| +$/g, '');
  if (name.length > 120) {
    name = name.slice(0, 120);
    const lastUnit = name.charCodeAt(name.length - 1);
    if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) name = name.slice(0, -1);
  }
  name = name.replace(/ +$/g, '');
  return name.length === 0 ? 'attachment' : name;
}

const TOKEN_BYTES = new Set(
  [...'!#$&+-.^_`|~abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map((ch) =>
    ch.charCodeAt(0),
  ),
);

export function contentDisposition(filename: string): string {
  const fallback = [...filename]
    .map((ch) => ((ch.codePointAt(0) ?? 0) > 0x7e ? '_' : ch))
    .join('');
  const encoded = [...Buffer.from(filename, 'utf8')]
    .map((byte) => (TOKEN_BYTES.has(byte) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`))
    .join('');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
