export interface MultipartPart {
  name: string;
  fileName: string | null;
  contentType: string | null;
  value: Buffer;
}

const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');

function headerValue(headers: string, name: string): string | null {
  const pattern = new RegExp(`^${name}:\\s*(.+)$`, 'im');
  const match = pattern.exec(headers);
  return match ? match[1]!.trim() : null;
}

function dispositionField(disposition: string, key: string): string | null {
  const quoted = new RegExp(`${key}="([^"]*)"`, 'i').exec(disposition);
  if (quoted) return quoted[1]!;
  const bare = new RegExp(`${key}=([^;]+)`, 'i').exec(disposition);
  return bare ? bare[1]!.trim() : null;
}

export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let cursor = body.indexOf(delimiter);
  if (cursor === -1) return parts;

  while (cursor !== -1) {
    const afterDelimiter = cursor + delimiter.length;
    if (body.subarray(afterDelimiter, afterDelimiter + 2).toString('latin1') === '--') break;
    const headerStart = afterDelimiter + CRLF.length;
    const headerEnd = body.indexOf(HEADER_END, headerStart);
    if (headerEnd === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const contentStart = headerEnd + HEADER_END.length;
    const next = body.indexOf(delimiter, contentStart);
    if (next === -1) break;
    const content = body.subarray(contentStart, Math.max(contentStart, next - CRLF.length));

    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const name = dispositionField(disposition, 'name');
    if (name !== null) {
      parts.push({
        name,
        fileName: dispositionField(disposition, 'filename'),
        contentType: headerValue(headers, 'content-type'),
        value: content,
      });
    }
    cursor = next;
  }
  return parts;
}

export function textField(parts: readonly MultipartPart[], name: string): string | null {
  const part = parts.find((candidate) => candidate.name === name && candidate.fileName === null);
  return part ? part.value.toString('utf8') : null;
}

export function fileField(parts: readonly MultipartPart[], name: string): MultipartPart | null {
  return parts.find((candidate) => candidate.name === name && candidate.fileName !== null) ?? null;
}
