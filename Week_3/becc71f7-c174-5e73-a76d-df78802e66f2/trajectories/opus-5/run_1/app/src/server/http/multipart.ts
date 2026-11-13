export interface MultipartFile {
  name: string;
  filename: string | null;
  contentType: string | null;
  bytes: Buffer;
}

/** The parts of a `multipart/form-data` body, enough for one file part named `photo`. */
export function parseMultipart(body: Buffer, contentType: string): MultipartFile[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const marker = (boundary?.[1] ?? boundary?.[2] ?? '').trim();
  if (marker === '') return [];

  const delimiter = Buffer.from(`--${marker}`, 'latin1');
  const parts: MultipartFile[] = [];
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1 || headerEnd > next) {
      at = next;
      continue;
    }
    const headerText = body.subarray(start, headerEnd).toString('utf8');
    const content = body.subarray(headerEnd + 4, next - 2);
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const partName = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    const partType = /content-type:\s*([^\r\n;]+)/i.exec(headerText)?.[1]?.trim() ?? null;
    parts.push({ name: partName, filename, contentType: partType, bytes: Buffer.from(content) });
    at = next;
  }
  return parts;
}
