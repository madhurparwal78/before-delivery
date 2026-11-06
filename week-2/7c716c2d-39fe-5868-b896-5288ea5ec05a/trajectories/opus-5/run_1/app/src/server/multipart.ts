import { ApiError } from './errors.js';

export type FilePart = { filename: string; contentType: string; bytes: Buffer };

function boundaryOf(contentType: string | undefined): string {
  const match = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType ?? '');
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined) throw new ApiError('unsupported_media_type');
  return boundary;
}

/** Browsers escape quotes and line breaks in a multipart filename. */
function decodeFilename(raw: string): string {
  return raw
    .replace(/\\"/g, '"')
    .replace(/%22/g, '"')
    .replace(/%0A/gi, '\n')
    .replace(/%0D/gi, '\r');
}

/** Reads the `file` part of a multipart/form-data body. */
export function parseFilePart(body: Buffer, contentType: string | undefined, fieldName: string): FilePart {
  const boundary = boundaryOf(contentType);
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const parts: Buffer[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    parts.push(body.subarray(start, next));
    index = next;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const nameMatch = /name="([^"]*)"/i.exec(disposition);
    if (nameMatch?.[1] !== fieldName) continue;
    const filenameMatch = /filename="(.*)"/i.exec(disposition);
    if (filenameMatch?.[1] === undefined) continue;
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    let bytes = part.subarray(headerEnd + 4);
    if (bytes.subarray(-2).toString('latin1') === '\r\n') bytes = bytes.subarray(0, bytes.length - 2);
    return {
      filename: decodeFilename(filenameMatch[1]),
      contentType: typeMatch?.[1]?.trim() ?? 'application/octet-stream',
      bytes,
    };
  }
  throw new ApiError('validation', {
    fields: { file: 'Choose a file to attach.' },
    message: 'Choose a file to attach.',
  });
}
