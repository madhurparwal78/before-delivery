export interface MultipartFile {
  fieldName: string;
  fileName: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: MultipartFile[];
}

export function parseMultipart(body: Buffer, contentType: string | undefined): MultipartBody | null {
  if (contentType === undefined) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined) return null;
  const separator = Buffer.from(`--${boundary.trim()}`);
  const parsed: MultipartBody = { fields: {}, files: [] };
  let cursor = body.indexOf(separator);
  if (cursor === -1) return null;
  cursor += separator.length;
  for (;;) {
    if (body.subarray(cursor, cursor + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', cursor);
    if (headerEnd === -1) break;
    const headers = body.subarray(cursor, headerEnd).toString('utf8');
    const next = body.indexOf(separator, headerEnd);
    if (next === -1) break;
    const content = body.subarray(headerEnd + 4, next - 2);
    const nameMatch = /name="([^"]*)"/.exec(headers);
    const fileMatch = /filename="([^"]*)"/.exec(headers);
    const fieldName = nameMatch?.[1] ?? '';
    if (fileMatch === null) parsed.fields[fieldName] = content.toString('utf8');
    else parsed.files.push({ fieldName, fileName: fileMatch[1] ?? '', bytes: Buffer.from(content) });
    cursor = next + separator.length;
  }
  return parsed;
}
