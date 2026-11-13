import type { IncomingMessage } from 'node:http';
import { payloadTooLarge } from './errors.js';

/** Reads a request body, draining anything past the limit so the error can answer. */
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let exceeded = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBytes) {
      exceeded = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (exceeded) throw payloadTooLarge();
  return Buffer.concat(chunks);
}

export async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const body = await readBody(req, maxBytes);
  if (body.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface MultipartField {
  name: string;
  filename: string | null;
  contentType: string | null;
  data: Buffer;
}

function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary ? boundary.trim() : null;
}

/** Parses multipart/form-data into its named parts. */
export function parseMultipart(body: Buffer, contentType: string | undefined): MultipartField[] {
  const boundary = boundaryOf(contentType);
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: MultipartField[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(delimiter, start);
    const end = next === -1 ? body.length : next;
    const section = body.subarray(start, end);
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = section.subarray(0, headerEnd).toString('utf8');
      let data = section.subarray(headerEnd + 4);
      if (data.subarray(data.length - 2).toString() === '\r\n') data = data.subarray(0, data.length - 2);
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
      if (nameMatch) {
        fields.push({
          name: nameMatch[1] as string,
          filename: filenameMatch ? (filenameMatch[1] as string) : null,
          contentType: typeMatch ? (typeMatch[1] as string).trim() : null,
          data: Buffer.from(data),
        });
      }
    }
    if (next === -1) break;
    index = next;
  }
  return fields;
}

export function textField(fields: readonly MultipartField[], name: string): string | undefined {
  const field = fields.find((candidate) => candidate.name === name && candidate.filename === null);
  return field ? field.data.toString('utf8') : undefined;
}

export function fileField(fields: readonly MultipartField[], name: string): MultipartField | undefined {
  return fields.find((candidate) => candidate.name === name && candidate.filename !== null);
}
