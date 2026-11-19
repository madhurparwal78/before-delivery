export interface MultipartFile {
  name: string;
  fileName: string;
  content: Buffer;
}

export interface MultipartBody {
  fields: Map<string, string>;
  files: Map<string, MultipartFile>;
}

function headerValue(headers: string, name: string): string | null {
  const match = new RegExp(`^${name}:(.*)$`, 'im').exec(headers);
  return match ? match[1].trim() : null;
}

function dispositionParameter(disposition: string, name: string): string | null {
  const quoted = new RegExp(`${name}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(disposition);
  if (quoted) {
    return quoted[1].replace(/\\(.)/g, '$1');
  }
  const bare = new RegExp(`${name}=([^;]+)`, 'i').exec(disposition);
  return bare ? bare[1].trim() : null;
}

export function boundaryOf(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) {
    return null;
  }
  return (match[1] ?? match[2]).trim();
}

export function parseMultipart(body: Buffer, boundary: string): MultipartBody {
  const fields = new Map<string, string>();
  const files = new Map<string, MultipartFile>();
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    let partStart = cursor + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString('latin1') === '--') {
      break;
    }
    if (body.subarray(partStart, partStart + 2).toString('latin1') === '\r\n') {
      partStart += 2;
    }
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n', 'latin1'), partStart);
    if (headerEnd === -1) {
      break;
    }
    const headers = body.subarray(partStart, headerEnd).toString('latin1');
    const contentStart = headerEnd + 4;
    const nextDelimiter = body.indexOf(delimiter, contentStart);
    const contentEnd = nextDelimiter === -1 ? body.length : nextDelimiter - 2;
    const content = body.subarray(contentStart, Math.max(contentStart, contentEnd));
    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const name = dispositionParameter(disposition, 'name');
    if (name !== null) {
      const fileName = dispositionParameter(disposition, 'filename');
      if (fileName !== null) {
        files.set(name, { name, fileName, content: Buffer.from(content) });
      } else {
        fields.set(name, content.toString('utf8'));
      }
    }
    cursor = nextDelimiter;
  }
  return { fields, files };
}
