// multipart/form-data, read from a body that is already in memory. The upload route needs the
// file name exactly as it was sent — including a name the product must refuse — so the parts are
// read here rather than through a library that may tidy them first.

interface Part {
  name: string;
  fileName: string | null;
  contentType: string;
  bytes: Buffer;
}

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const found = (match?.[1] ?? match?.[2] ?? '').trim();
  return found.length > 0 ? found : null;
}

export function parseMultipart(body: Buffer, boundary: string): Part[] {
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  const parts: Part[] = [];
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const raw = body.subarray(start + 2, Math.max(start + 2, next - 2));
    const split = raw.indexOf('\r\n\r\n');
    if (split >= 0) {
      const headers = raw.subarray(0, split).toString('utf8');
      const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? '';
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? '';
      const fileName = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
      const contentType = (/content-type:\s*([^\r\n;]*)/i.exec(headers)?.[1] ?? '').trim();
      parts.push({ name, fileName, contentType, bytes: raw.subarray(split + 4) });
    }
    at = next;
  }
  return parts;
}
