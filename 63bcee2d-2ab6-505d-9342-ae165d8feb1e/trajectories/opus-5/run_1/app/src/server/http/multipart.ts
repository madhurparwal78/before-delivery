/**
 * Multipart form reading. Bodies are already capped by the published limit
 * before they reach here, so the whole body is parsed in memory.
 */

export interface UploadedFile {
  field: string;
  fileName: string;
  bytes: Buffer;
}

export interface Multipart {
  fields: Record<string, string>;
  files: UploadedFile[];
}

export function boundaryOf(contentType: string): string | null {
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary === undefined || boundary === '' ? null : boundary;
}

function headerValue(headers: string, name: string): string | null {
  for (const line of headers.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toLowerCase() === name) return line.slice(colon + 1).trim();
  }
  return null;
}

function dispositionParameter(disposition: string, name: string): string | null {
  const quoted = new RegExp(`;\\s*${name}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(disposition);
  if (quoted?.[1] !== undefined) return quoted[1].replace(/\\(.)/g, '$1');
  const bare = new RegExp(`;\\s*${name}=([^;]+)`, 'i').exec(disposition);
  return bare?.[1] !== undefined ? bare[1].trim() : null;
}

export function parseMultipart(body: Buffer, boundary: string): Multipart {
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];

  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const afterDelimiter = at + delimiter.byteLength;
    if (body.subarray(afterDelimiter, afterDelimiter + 2).toString('latin1') === '--') break;

    const headerStart = afterDelimiter + 2;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart, 'latin1');
    if (headerEnd === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const next = body.indexOf(delimiter, contentStart);
    const contentEnd = next === -1 ? body.byteLength : next - 2;
    const content = body.subarray(contentStart, Math.max(contentStart, contentEnd));

    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const name = dispositionParameter(disposition, 'name');
    const fileName = dispositionParameter(disposition, 'filename');
    if (name !== null) {
      if (fileName !== null) {
        files.push({ field: name, fileName, bytes: Buffer.from(content) });
      } else {
        fields[name] = content.toString('utf8');
      }
    }

    if (next === -1) break;
    at = next;
  }

  return { fields, files };
}
