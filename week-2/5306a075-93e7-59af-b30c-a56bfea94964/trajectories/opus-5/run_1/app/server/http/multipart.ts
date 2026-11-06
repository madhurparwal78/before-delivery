export interface MultipartFile {
  field: string;
  filename: string;
  bytes: Buffer;
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/u.exec(contentType);
  if (!match) return null;
  return (match[1] ?? match[2]).trim();
}

/** Reads the file parts of a multipart/form-data body. */
export function parseMultipartFiles(body: Buffer, contentType: string): MultipartFile[] {
  const boundary = boundaryOf(contentType);
  if (boundary === null) return [];
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const files: MultipartFile[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    let start = index + delimiter.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    if (body.subarray(start, start + 2).toString('latin1') === '\r\n') start += 2;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const partEnd = next - 2 >= start ? next - 2 : next;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd !== -1 && headerEnd < partEnd) {
      const headers = body.subarray(start, headerEnd).toString('utf8');
      const disposition = /content-disposition:([^\r\n]*)/iu.exec(headers)?.[1] ?? '';
      const field = /name="([^"]*)"/iu.exec(disposition)?.[1];
      const filename = readFilename(disposition);
      if (field !== undefined && filename !== null) {
        files.push({ field, filename, bytes: body.subarray(headerEnd + 4, partEnd) });
      }
    }
    index = next;
  }
  return files;
}

function readFilename(disposition: string): string | null {
  const extended = /filename\*=UTF-8''([^;\s]+)/iu.exec(disposition);
  if (extended) return decodeURIComponent(extended[1]);
  const plain = /filename="([^"]*)"/iu.exec(disposition);
  return plain ? plain[1] : null;
}
