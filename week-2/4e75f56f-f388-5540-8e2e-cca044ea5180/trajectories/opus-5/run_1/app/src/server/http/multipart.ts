export interface MultipartFile {
  readonly field: string;
  readonly content: Buffer;
}

export interface MultipartBody {
  readonly fields: Record<string, string>;
  readonly files: readonly MultipartFile[];
}

const CRLF = Buffer.from('\r\n');
const DOUBLE_CRLF = Buffer.from('\r\n\r\n');

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary === undefined ? null : boundary.trim();
}

export function parseMultipart(body: Buffer, boundary: string): MultipartBody | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  let cursor = body.indexOf(delimiter);
  if (cursor === -1) return null;
  cursor += delimiter.length;

  for (;;) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (!body.subarray(cursor, cursor + 2).equals(CRLF)) return null;
    cursor += 2;

    const headerEnd = body.indexOf(DOUBLE_CRLF, cursor);
    if (headerEnd === -1) return null;
    const headerText = body.subarray(cursor, headerEnd).toString('latin1');
    const contentStart = headerEnd + DOUBLE_CRLF.length;

    const next = body.indexOf(delimiter, contentStart);
    if (next === -1) return null;
    const content = body.subarray(contentStart, next - CRLF.length);

    const disposition = headerText
      .split('\r\n')
      .find((line) => /^content-disposition:/i.test(line));
    if (disposition === undefined) return null;
    const nameMatch = /name="([^"]*)"/i.exec(disposition);
    const field = nameMatch?.[1];
    if (field === undefined) return null;
    const isFile = /filename="/i.test(disposition);
    if (isFile) {
      files.push({ field, content: Buffer.from(content) });
    } else {
      fields[field] = content.toString('utf8');
    }

    cursor = next + delimiter.length;
  }

  return { fields, files };
}

export type UploadType = 'application/pdf' | 'image/jpeg' | 'image/png';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The content type decided from the file's leading bytes alone. */
export function sniffUploadType(content: Buffer): UploadType | null {
  if (content.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return 'image/jpeg';
  }
  if (content.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  return null;
}

export function extensionFor(type: UploadType): string {
  if (type === 'application/pdf') return 'pdf';
  return type === 'image/jpeg' ? 'jpg' : 'png';
}
