/** The one definition of the attachment content check, canonical type and filename. */

export const MAX_ATTACHMENT_BYTES = 10_000_000;

const CANONICAL_TYPES: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return null;
  const extension = filename.slice(dot).toLowerCase();
  return extension in CANONICAL_TYPES ? extension : null;
}

export function canonicalContentType(extension: string): string {
  return CANONICAL_TYPES[extension];
}

function isValidUtf8WithoutNul(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  const decoded = new TextDecoder('utf-8', { fatal: true });
  try {
    decoded.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function bytesMatchExtension(extension: string, bytes: Buffer): boolean {
  switch (extension) {
    case '.png':
      return bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
    case '.jpg':
    case '.jpeg':
      return bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
    case '.pdf':
      return bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
    case '.txt':
      return isValidUtf8WithoutNul(bytes);
    case '.vtt': {
      if (!isValidUtf8WithoutNul(bytes)) return false;
      const body = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)
        ? bytes.subarray(UTF8_BOM.length)
        : bytes;
      const head = body.subarray(0, 6).toString('utf8');
      if (head !== 'WEBVTT') return false;
      if (body.length === 6) return true;
      const next = body.subarray(6, 8).toString('utf8');
      return next[0] === ' ' || next[0] === '\t' || next[0] === '\n' || next.startsWith('\r\n');
    }
    default:
      return false;
  }
}

const MAX_FILENAME_LENGTH = 120;

/** Last path segment, NFC-normalised, cut to 120 characters with its extension kept. */
export function displayFilename(clientName: string): string {
  const segments = clientName.split(/[/\\]/u);
  const last = segments[segments.length - 1] ?? '';
  const normalised = last.normalize('NFC');
  const dot = normalised.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < normalised.length - 1;
  const base = hasExtension ? normalised.slice(0, dot) : normalised;
  const extension = hasExtension ? normalised.slice(dot) : '';
  if (base === '') return `file${extension}`;
  const room = MAX_FILENAME_LENGTH - extension.length;
  const cut = room <= 0 ? '' : base.slice(0, room);
  if (cut === '') return `file${extension}`;
  return `${cut}${extension}`;
}

/** The storage key segment: safe characters only. */
export function safeObjectName(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/gu, '-');
}

export function attachmentObjectKey(noteId: string, attachmentId: string, filename: string): string {
  return `notes/${noteId}/${attachmentId}-${safeObjectName(filename)}`;
}

export function noteObjectPrefix(noteId: string): string {
  return `notes/${noteId}/`;
}

const RFC5987_SAFE = /[A-Za-z0-9!#$&+\-.^_`|~]/u;

/** Content-Disposition for a download, with an ASCII fallback and a UTF-8 form. */
export function contentDisposition(filename: string): string {
  const fallback = [...filename]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code > 127 || character === '"' || character === '\\') return '_';
      return character;
    })
    .join('');
  let encoded = '';
  for (const byte of Buffer.from(filename, 'utf8')) {
    const character = String.fromCharCode(byte);
    encoded += RFC5987_SAFE.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
