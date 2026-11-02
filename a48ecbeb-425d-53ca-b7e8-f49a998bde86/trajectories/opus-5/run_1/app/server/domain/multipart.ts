export interface MultipartFile {
  field: string;
  filename: string;
  declaredType: string;
  content: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: MultipartFile[];
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : value.trim();
}

/** Reads a `multipart/form-data` body: the application upload is the only one. */
export function parseMultipart(raw: Buffer, contentType: string): MultipartBody | null {
  const boundary = boundaryOf(contentType);
  if (boundary === null) return null;

  const separator = Buffer.from(`--${boundary}`);
  const body: MultipartBody = { fields: {}, files: [] };
  let cursor = raw.indexOf(separator);
  if (cursor === -1) return null;

  while (cursor !== -1) {
    const partStart = cursor + separator.byteLength;
    if (raw.slice(partStart, partStart + 2).toString() === '--') break;
    const next = raw.indexOf(separator, partStart);
    if (next === -1) break;

    const part = raw.slice(partStart + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      cursor = next;
      continue;
    }
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const content = part.slice(headerEnd + 4);
    const disposition = /name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(headerText);
    const declaredType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? '';
    const field = disposition?.[1] ?? '';
    const filename = disposition?.[2];

    if (filename === undefined) body.fields[field] = content.toString('utf8');
    else body.files.push({ field, filename, declaredType, content });

    cursor = next;
  }
  return body;
}

export type LicenceType = 'pdf' | 'png' | 'jpg';

/** A file's type is judged by its first bytes, not its name or declared type. */
export function sniffLicenceType(content: Buffer): LicenceType | null {
  if (content.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'jpg';
  return null;
}

export const LICENCE_CONTENT_TYPES: Readonly<Record<LicenceType, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
};
