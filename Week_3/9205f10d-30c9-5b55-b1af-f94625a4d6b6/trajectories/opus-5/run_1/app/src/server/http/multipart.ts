export interface MultipartFile {
  field: string;
  file_name: string;
  content: Buffer;
}

export interface MultipartBody {
  fields: Map<string, string>;
  files: MultipartFile[];
}

export function boundaryOf(contentType: string): string | null {
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function headerValue(headers: string, name: string): string | null {
  const pattern = new RegExp(`^${name}:\\s*(.*)$`, 'im');
  const match = pattern.exec(headers);
  return match ? (match[1] as string).trim() : null;
}

function dispositionParameter(disposition: string, name: string): string | null {
  const quoted = new RegExp(`;\\s*${name}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(disposition);
  if (quoted) return (quoted[1] as string).replace(/\\(.)/g, '$1');
  const bare = new RegExp(`;\\s*${name}=([^;]+)`, 'i').exec(disposition);
  return bare ? (bare[1] as string).trim() : null;
}

export function parseMultipart(raw: Buffer, boundary: string): MultipartBody | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const body: MultipartBody = { fields: new Map(), files: [] };
  let cursor = raw.indexOf(delimiter);
  if (cursor < 0) return null;
  while (cursor >= 0) {
    let partStart = cursor + delimiter.length;
    if (raw.subarray(partStart, partStart + 2).toString('latin1') === '--') break;
    if (raw.subarray(partStart, partStart + 2).toString('latin1') === '\r\n') partStart += 2;
    const headerEnd = raw.indexOf('\r\n\r\n', partStart, 'latin1');
    if (headerEnd < 0) return null;
    const headers = raw.subarray(partStart, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const next = raw.indexOf(delimiter, contentStart);
    if (next < 0) return null;
    let contentEnd = next;
    if (raw.subarray(contentEnd - 2, contentEnd).toString('latin1') === '\r\n') contentEnd -= 2;
    const content = raw.subarray(contentStart, contentEnd);
    const disposition = headerValue(headers, 'content-disposition');
    const field = disposition ? dispositionParameter(disposition, 'name') : null;
    if (field !== null) {
      const fileName = disposition ? dispositionParameter(disposition, 'filename') : null;
      if (fileName === null) body.fields.set(field, content.toString('utf8'));
      else body.files.push({ field, file_name: fileName, content: Buffer.from(content) });
    }
    cursor = next;
  }
  return body;
}

/** Keeps only the last path part of an uploaded name, with control characters removed. */
export function displayFileName(raw: string): string {
  const lastPart = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return lastPart.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
}

export type DetectedFileType = 'pdf' | 'png' | 'jpg';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** The file type is judged by its leading bytes; the name and declared type are ignored. */
export function detectFileType(content: Buffer): DetectedFileType | null {
  if (content.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) return 'pdf';
  if (content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'png';
  if (content.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return 'jpg';
  return null;
}

export const CONTENT_TYPE_BY_FILE_TYPE: Record<DetectedFileType, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
};
