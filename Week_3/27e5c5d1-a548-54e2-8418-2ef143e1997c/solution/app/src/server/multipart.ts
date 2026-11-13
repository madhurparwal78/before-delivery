import type { Upload } from './http-types.ts';

/**
 * The one file field of a multipart upload. The file name is read up to the last quote of its header line, so
 * a name that carries quotes survives, and a browser's %22 escape is turned back into a quote.
 */
export function parseUpload(body: Buffer, contentType: string): Upload | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const token = boundary?.[1] ?? boundary?.[2];
  if (!token) return null;
  const delimiter = Buffer.from(`--${token}`);
  let from = body.indexOf(delimiter);
  while (from >= 0) {
    const start = from + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') return null;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (headerEnd < 0 || next < 0) return null;
    const head = body.subarray(start, headerEnd).toString('utf8');
    const disposition = /^content-disposition:[^\r\n]*$/im.exec(head)?.[0] ?? '';
    if (/\bname="file"/i.test(disposition)) {
      const filename = /filename="(.*)"[^"]*$/.exec(disposition)?.[1];
      const type = /^content-type:\s*([^\r\n;]+)/im.exec(head)?.[1]?.trim().toLowerCase() ?? '';
      if (filename === undefined) return null;
      return { filename: filename.replaceAll('%22', '"'), contentType: type, bytes: body.subarray(headerEnd + 4, next - 2) };
    }
    from = next;
  }
  return null;
}
