export interface UploadedFile {
  fieldName: string;
  fileName: string;
  contentType: string;
  content: Buffer;
}

export interface MultipartForm {
  fields: Map<string, string>;
  files: Map<string, UploadedFile>;
}

function readBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary ? boundary.trim() : null;
}

function parseDisposition(header: string): { name: string | null; filename: string | null } {
  const name = /name="([^"]*)"/.exec(header)?.[1] ?? null;
  const filename = /filename="([^"]*)"/.exec(header)?.[1] ?? null;
  return { name, filename };
}

export function parseMultipart(raw: Buffer, contentType: string): MultipartForm | null {
  const boundary = readBoundary(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  const fields = new Map<string, string>();
  const files = new Map<string, UploadedFile>();
  let cursor = raw.indexOf(delimiter);
  if (cursor < 0) return null;
  cursor += delimiter.length;
  for (;;) {
    if (raw.slice(cursor, cursor + 2).toString('latin1') === '--') break;
    if (raw.slice(cursor, cursor + 2).toString('latin1') === '\r\n') cursor += 2;
    const headerEnd = raw.indexOf('\r\n\r\n', cursor, 'latin1');
    if (headerEnd < 0) break;
    const headerText = raw.slice(cursor, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const next = raw.indexOf(delimiter, bodyStart);
    if (next < 0) break;
    const body = raw.slice(bodyStart, next - 2);
    const disposition = headerText
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-disposition:'));
    const partType =
      headerText
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('content-type:'))
        ?.slice('content-type:'.length)
        .trim() ?? 'application/octet-stream';
    if (disposition) {
      const { name, filename } = parseDisposition(disposition);
      if (name !== null) {
        if (filename === null) fields.set(name, body.toString('utf8'));
        else files.set(name, { fieldName: name, fileName: filename, contentType: partType, content: body });
      }
    }
    cursor = next + delimiter.length;
  }
  return { fields, files };
}

const SIGNATURES: Record<string, (content: Buffer) => boolean> = {
  'image/png': (content) => content.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (content) => content.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/webp': (content) =>
    content.slice(0, 4).toString('latin1') === 'RIFF' && content.slice(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (content) => content.slice(0, 4).toString('latin1') === '%PDF',
  'audio/ogg': (content) => content.slice(0, 4).toString('latin1') === 'OggS',
  'audio/mpeg': (content) =>
    content.slice(0, 3).toString('latin1') === 'ID3' ||
    (content.length > 1 && content[0] === 0xff && ((content[1] as number) & 0xe0) === 0xe0),
};

/** The declared type must match the file's signature. */
export function signatureMatches(contentType: string, content: Buffer): boolean {
  const check = SIGNATURES[contentType];
  return check ? check(content) : false;
}

/** Stored names are lowercased, with anything outside letters, digits, dot, underscore and hyphen replaced. */
export function safeFileName(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}
