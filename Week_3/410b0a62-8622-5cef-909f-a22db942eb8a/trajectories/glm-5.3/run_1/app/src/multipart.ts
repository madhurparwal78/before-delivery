import type { Request } from 'express';

export interface MultipartFile {
  name: string;
  data: Buffer;
}

export interface ParsedMultipart {
  file: MultipartFile | null;
  fields: Record<string, string>;
}

/** Minimal multipart/form-data reader for exactly one file part plus text fields. */
export function parseMultipart(req: Request): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] ?? '';
    const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    if (!match) {
      reject(new Error('missing boundary'));
      return;
    }
    const boundary = (match[1] ?? match[2])!.trim();
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('aborted', () => reject(new Error('aborted')));
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(parseBuffer(Buffer.concat(chunks), boundary));
      } catch (err) {
        reject(err as Error);
      }
    });
    void contentType;
  });
}

export function parseBufferForTest(body: Buffer, boundary: string): ParsedMultipart {
  return parseBuffer(body, boundary);
}

function parseBuffer(body: Buffer, boundary: string): ParsedMultipart {
  const fields: Record<string, string> = {};
  let file: MultipartFile | null = null;
  const marker = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let pos = body.indexOf(marker);
  while (pos !== -1) {
    const next = body.indexOf(marker, pos + marker.length);
    if (next === -1) break;
    // Part content sits between the boundary line's trailing CRLF and the CRLF before the next boundary.
    let start = pos + marker.length;
    if (body.slice(start, start + 2).toString('utf8') === '\r\n') start += 2;
    let end = next;
    if (end >= 2 && body.slice(end - 2, end).toString('utf8') === '\r\n') end -= 2;
    if (start <= end) parts.push(body.subarray(start, end));
    pos = next;
  }
  for (const raw of parts) {
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = raw.subarray(0, headerEnd).toString('utf8');
    const content = raw.subarray(headerEnd + 4);
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const nameMatch = /name="([^"]*)"/.exec(disposition);
    const filenameMatch = /filename="([^"]*)"/.exec(disposition);
    const fieldName = nameMatch?.[1];
    if (!fieldName) continue;
    if (filenameMatch) {
      file = { name: filenameMatch[1] ?? '', data: Buffer.from(content) };
    } else {
      fields[fieldName] = content.toString('utf8');
    }
  }
  return { file, fields };
}
