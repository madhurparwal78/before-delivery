import type { Request } from 'express';
import { refuse } from '../domain/errors';
import { UPLOAD_REQUEST_LIMIT } from './boundary';

export interface MultipartFile {
  name: string;
  /** The file name exactly as the request gave it, so a refused name can be refused. */
  fileName: string;
  bytes: Buffer;
}

export interface ParsedMultipart {
  fields: Map<string, string>;
  file: MultipartFile | null;
}

const boundaryOf = (contentType: string): string => {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (match === null) throw refuse(415, 'unsupported_media_type', 'That multipart body has no boundary');
  return (match[1] ?? match[2]).trim();
};

const readWholeRequest = (request: Request): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > UPLOAD_REQUEST_LIMIT) {
        settled = true;
        request.pause();
        reject(refuse(413, 'file_too_large', 'This file is over the size limit'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });

const dispositionOf = (headers: string): { name: string | null; fileName: string | null } => {
  const line = headers
    .split('\r\n')
    .find((candidate) => candidate.toLowerCase().startsWith('content-disposition:'));
  if (line === undefined) return { name: null, fileName: null };
  const name = /\bname="([^"]*)"/.exec(line);
  const fileName = /\bfilename="([^"]*)"/.exec(line);
  return { name: name === null ? null : name[1], fileName: fileName === null ? null : fileName[1] };
};

/**
 * Reads one multipart body of fields and at most one file. The file name is kept
 * exactly as sent, so a name holding a path separator, a parent hop or a NUL byte can
 * be refused rather than quietly cleaned up.
 */
export const parseMultipart = async (request: Request): Promise<ParsedMultipart> => {
  const contentType = request.headers['content-type'] ?? '';
  const boundary = Buffer.from(`--${boundaryOf(contentType)}`, 'latin1');
  const body = await readWholeRequest(request);

  const fields = new Map<string, string>();
  let file: MultipartFile | null = null;

  let at = body.indexOf(boundary);
  while (at >= 0) {
    const partStart = at + boundary.length;
    if (body.subarray(partStart, partStart + 2).toString('latin1') === '--') break;
    const next = body.indexOf(boundary, partStart);
    if (next < 0) break;

    const part = body.subarray(partStart + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split >= 0) {
      const headers = part.subarray(0, split).toString('utf8');
      const content = part.subarray(split + 4);
      const { name, fileName } = dispositionOf(headers);
      if (name !== null) {
        if (fileName === null) fields.set(name, content.toString('utf8'));
        else if (file === null) file = { name, fileName, bytes: content };
      }
    }
    at = next;
  }

  return { fields, file };
};
