export interface MultipartPart {
  name: string;
  fileName: string | null;
  contentType: string | null;
  bytes: Buffer;
}

export function parseMultipart(body: Buffer, contentType: string): MultipartPart[] {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary.trim()}`);
  const parts: MultipartPart[] = [];
  let index = body.indexOf(delimiter);
  while (index >= 0) {
    const start = index + delimiter.length;
    if (body.subarray(start, start + 2).toString('ascii') === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf('\r\n\r\n');
    if (split >= 0) {
      const headerText = chunk.subarray(0, split).toString('utf8');
      const bytes = chunk.subarray(split + 4);
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const fileMatch = /filename="([^"]*)"/i.exec(headerText);
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
      parts.push({
        name: nameMatch?.[1] ?? '',
        fileName: fileMatch?.[1] ?? null,
        contentType: typeMatch?.[1]?.trim() ?? null,
        bytes,
      });
    }
    index = next;
  }
  return parts;
}
