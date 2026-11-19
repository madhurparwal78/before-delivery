export type MultipartPart = {
  name: string;
  filename?: string;
  declaredType?: string;
  data: Buffer;
};

function headerValue(headers: string, key: string): string | undefined {
  const match = new RegExp(`${key}:\\s*([^\\r\\n]*)`, 'i').exec(headers);
  return match ? match[1].trim() : undefined;
}

function dispositionField(disposition: string, key: string): string | undefined {
  const quoted = new RegExp(`${key}="([^"]*)"`, 'i').exec(disposition);
  if (quoted) return quoted[1];
  const plain = new RegExp(`${key}=([^;]+)`, 'i').exec(disposition);
  return plain ? plain[1].trim() : undefined;
}

/** Reads multipart/form-data, keeping file bytes and UTF-8 names exactly as sent. */
export function parseMultipart(buffer: Buffer, contentType: string): MultipartPart[] {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) return [];
  const boundary = `--${(boundaryMatch[1] ?? boundaryMatch[2]).trim()}`;
  const parts: MultipartPart[] = [];
  const boundaryBuffer = Buffer.from(boundary);
  let index = buffer.indexOf(boundaryBuffer);
  while (index !== -1) {
    const afterBoundary = index + boundaryBuffer.length;
    if (buffer.slice(afterBoundary, afterBoundary + 2).toString() === '--') break;
    const headerStart = afterBoundary + 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) break;
    const headers = buffer.slice(headerStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuffer, dataStart);
    const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2;
    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const name = dispositionField(disposition, 'name');
    if (name) {
      parts.push({
        name,
        filename: dispositionField(disposition, 'filename'),
        declaredType: headerValue(headers, 'content-type'),
        data: buffer.slice(dataStart, Math.max(dataStart, dataEnd)),
      });
    }
    index = nextBoundary;
  }
  return parts;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-');

/** The type of an upload is judged only by its bytes at offset 0. */
export function sniffContentType(data: Buffer): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (data.length >= JPEG.length && data.subarray(0, JPEG.length).equals(JPEG)) return 'image/jpeg';
  if (data.length >= PNG.length && data.subarray(0, PNG.length).equals(PNG)) return 'image/png';
  if (data.length >= PDF.length && data.subarray(0, PDF.length).equals(PDF)) return 'application/pdf';
  return null;
}
