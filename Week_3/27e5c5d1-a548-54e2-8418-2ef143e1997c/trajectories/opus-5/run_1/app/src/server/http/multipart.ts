export interface FilePart {
  fieldName: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

function headerValue(headers: string, name: string): string | null {
  for (const line of headers.split('\r\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    if (line.slice(0, index).trim().toLowerCase() === name) return line.slice(index + 1).trim();
  }
  return null;
}

function parameterOf(value: string, name: string): string | null {
  const extended = new RegExp(`${name}\\*=UTF-8''([^;]+)`, 'i').exec(value);
  if (extended !== null && extended[1] !== undefined) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      return null;
    }
  }
  const quoted = new RegExp(`${name}="([^"]*)"`, 'i').exec(value);
  if (quoted !== null && quoted[1] !== undefined) return quoted[1];
  const bare = new RegExp(`${name}=([^;]+)`, 'i').exec(value);
  return bare !== null && bare[1] !== undefined ? bare[1].trim() : null;
}

export function boundaryOf(contentType: string): string | null {
  return parameterOf(contentType, 'boundary');
}

/** Browsers escape these three characters in a multipart file name. */
function unescapeFormFilename(filename: string): string {
  return filename.replace(/%22/g, '"').replace(/%0D/gi, '\r').replace(/%0A/gi, '\n');
}

/** Parses the file parts of a multipart/form-data body. Field parts are not used by this app. */
export function parseFileParts(body: Buffer, boundary: string): FilePart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: FilePart[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.slice(start, start + 2).toString('latin1') === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = body.slice(start + 2, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    const contentEnd = next === -1 ? body.length : next - 2;
    const bytes = body.slice(headerEnd + 4, Math.max(headerEnd + 4, contentEnd));
    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const filename = parameterOf(disposition, 'filename');
    const fieldName = parameterOf(disposition, 'name');
    if (filename !== null && fieldName !== null) {
      parts.push({
        fieldName,
        filename: unescapeFormFilename(filename),
        contentType: (headerValue(headers, 'content-type') ?? '').split(';')[0]?.trim() ?? '',
        bytes,
      });
    }
    index = next;
  }
  return parts;
}
