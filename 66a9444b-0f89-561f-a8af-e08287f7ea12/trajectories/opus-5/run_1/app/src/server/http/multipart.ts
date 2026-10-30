export interface UploadedFile {
  fieldName: string;
  filename: string;
  declaredType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: UploadedFile[];
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : value.trim();
}

export function parseMultipart(raw: Buffer, contentType: string): MultipartBody {
  const boundary = boundaryOf(contentType);
  if (boundary === null) return { fields: {}, files: [] };
  const separator = Buffer.from(`--${boundary}`, 'latin1');

  const parts: Buffer[] = [];
  let cursor = raw.indexOf(separator);
  while (cursor !== -1) {
    const start = cursor + separator.byteLength;
    const next = raw.indexOf(separator, start);
    if (next === -1) break;
    parts.push(raw.subarray(start, next));
    cursor = next;
  }

  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    let body = part.subarray(headerEnd + 4);
    if (body.subarray(body.byteLength - 2).toString('latin1') === '\r\n') {
      body = body.subarray(0, body.byteLength - 2);
    }
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    if (nameMatch === null) continue;
    const fieldName = nameMatch[1] as string;
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText);

    if (filenameMatch === null) {
      fields[fieldName] = body.toString('utf8');
      continue;
    }
    files.push({
      fieldName,
      filename: filenameMatch[1] as string,
      declaredType: (typeMatch?.[1] ?? 'application/octet-stream').trim(),
      bytes: body,
    });
  }

  return { fields, files };
}
