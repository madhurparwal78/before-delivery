import { IncomingMessage } from 'node:http';
import { invalid } from './errors.js';

export interface MultipartPart {
  name: string;
  filename: string | null;
  bytes: Buffer;
}

function boundaryOf(contentType: string | undefined): string | null {
  if (contentType === undefined) return null;
  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  return match === null ? null : match[1];
}

export function parseMultipart(request: IncomingMessage, raw: Buffer): MultipartPart[] {
  const boundary = boundaryOf(request.headers['content-type']);
  if (boundary === null) throw invalid({ file: 'Expected a multipart body.' });
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const parts: MultipartPart[] = [];
  let index = raw.indexOf(delimiter);
  if (index < 0) throw invalid({ file: 'Expected a multipart body.' });
  index += delimiter.length;

  for (;;) {
    if (raw.subarray(index, index + 2).toString('latin1') === '--') break;
    if (raw.subarray(index, index + 2).toString('latin1') === '\r\n') index += 2;
    const headerEnd = raw.indexOf('\r\n\r\n', index);
    if (headerEnd < 0) break;
    const headerText = raw.subarray(index, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const next = raw.indexOf(delimiter, bodyStart);
    if (next < 0) break;
    const bodyEnd = next - 2;
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText);
    if (disposition === null) throw invalid({ file: 'Expected a multipart body.' });
    const nameMatch = /name="([^"]*)"/i.exec(disposition[1]);
    const filenameMatch = /filename="([^"]*)"/i.exec(disposition[1]);
    parts.push({
      name: nameMatch === null ? '' : nameMatch[1],
      filename: filenameMatch === null ? null : filenameMatch[1],
      bytes: raw.subarray(bodyStart, bodyEnd < bodyStart ? bodyStart : bodyEnd),
    });
    index = next + delimiter.length;
  }

  return parts;
}
