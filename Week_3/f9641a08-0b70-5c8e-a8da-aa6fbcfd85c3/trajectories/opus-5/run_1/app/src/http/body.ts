import { IncomingMessage } from 'node:http';

export type ReadResult = { body: Buffer; tooLarge: boolean };

export function readBody(request: IncomingMessage, limit: number): Promise<ReadResult> {
  return new Promise<ReadResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve({ body: Buffer.concat(chunks), tooLarge }));
    request.on('error', reject);
  });
}

export type MultipartField = { name: string; value: string };
export type MultipartFile = { name: string; filename: string; contentType: string; data: Buffer };
export type Multipart = { fields: MultipartField[]; files: MultipartFile[] };

function headerValue(headers: string[], name: string): string | null {
  const lower = name.toLowerCase();
  for (const line of headers) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    if (line.slice(0, index).trim().toLowerCase() === lower) return line.slice(index + 1).trim();
  }
  return null;
}

function parseDisposition(value: string): { name: string; filename: string | null } {
  const name = /name="([^"]*)"/.exec(value);
  const filename = /filename="([^"]*)"/.exec(value);
  return { name: name === null ? '' : name[1], filename: filename === null ? null : filename[1] };
}

export function parseMultipart(body: Buffer, contentType: string): Multipart | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (match === null) return null;
  const boundary = `--${(match[1] ?? match[2]).trim()}`;
  const separator = Buffer.from(`\r\n${boundary}`, 'utf8');
  const start = body.indexOf(Buffer.from(`${boundary}\r\n`, 'utf8'));
  if (start === -1) return null;
  const working = Buffer.concat([Buffer.from('\r\n', 'utf8'), body.subarray(start)]);

  const fields: MultipartField[] = [];
  const files: MultipartFile[] = [];
  let cursor = 0;
  while (true) {
    const partStart = working.indexOf(separator, cursor);
    if (partStart === -1) break;
    let headerStart = partStart + separator.length;
    if (working.subarray(headerStart, headerStart + 2).toString('utf8') === '--') break;
    if (working.subarray(headerStart, headerStart + 2).toString('utf8') === '\r\n') headerStart += 2;
    const headerEnd = working.indexOf(Buffer.from('\r\n\r\n', 'utf8'), headerStart);
    if (headerEnd === -1) break;
    const headerLines = working.subarray(headerStart, headerEnd).toString('utf8').split('\r\n');
    const dataStart = headerEnd + 4;
    const nextPart = working.indexOf(separator, dataStart);
    const dataEnd = nextPart === -1 ? working.length : nextPart;
    const data = working.subarray(dataStart, dataEnd);

    const disposition = headerValue(headerLines, 'content-disposition');
    if (disposition !== null) {
      const { name, filename } = parseDisposition(disposition);
      if (filename === null) {
        fields.push({ name, value: data.toString('utf8') });
      } else {
        files.push({
          name,
          filename,
          contentType: headerValue(headerLines, 'content-type') ?? 'application/octet-stream',
          data: Buffer.from(data)
        });
      }
    }
    cursor = dataEnd;
  }
  return { fields, files };
}

export function sniffContentType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const PDF_DANGER = [/\/JavaScript/i, /\/JS\b/, /\/Launch/i, /\/EmbeddedFile/i, /\/OpenAction/i, /\/AA\b/];

export function pdfIsPlain(data: Buffer): boolean {
  const text = data.toString('latin1');
  return !PDF_DANGER.some((pattern) => pattern.test(text));
}

export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, 120);
}
