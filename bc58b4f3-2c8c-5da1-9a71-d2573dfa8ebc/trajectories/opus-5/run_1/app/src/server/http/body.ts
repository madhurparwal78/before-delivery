import type { IncomingMessage } from 'node:http';
import { fail } from './errors.js';

export const JSON_BODY_LIMIT = 65536;
const UPLOAD_FILE_LIMIT = 5_000_000;
export const UPLOAD_BODY_LIMIT = 5_100_000;

export interface MultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartBody {
  fields: Map<string, string>;
  files: Map<string, MultipartFile>;
}

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined) {
    const length = Number.parseInt(declared, 10);
    if (Number.isFinite(length) && length > limit) fail('payload_too_large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      request.destroy();
      fail('payload_too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function parseJsonBody(request: IncomingMessage, raw: Buffer): Record<string, unknown> {
  const type = mediaType(request.headers['content-type']);
  if (type !== '' && type !== 'application/json') fail('unsupported_media_type');
  if (raw.length === 0) return {};
  if (type === '') fail('unsupported_media_type');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    fail('validation', { body: 'Send a JSON object.' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('validation', { body: 'Send a JSON object.' });
  }
  return parsed as Record<string, unknown>;
}

function parseDisposition(header: string): { name: string; filename: string | null } {
  const name = /name="([^"]*)"/.exec(header)?.[1] ?? '';
  const filename = /filename="([^"]*)"/.exec(header)?.[1] ?? null;
  return { name, filename };
}

export function parseMultipartBody(request: IncomingMessage, raw: Buffer): MultipartBody {
  const header = request.headers['content-type'] ?? '';
  if (mediaType(header) !== 'multipart/form-data') fail('unsupported_media_type');
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(header);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (marker === undefined) fail('unsupported_media_type');

  const delimiter = Buffer.from(`--${marker.trim()}`);
  const fields = new Map<string, string>();
  const files = new Map<string, MultipartFile>();

  let cursor = raw.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    if (raw.subarray(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = raw.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;
    const next = raw.indexOf(delimiter, headerEnd);
    const bodyEnd = next === -1 ? raw.length : next - 2;
    const headerText = raw.subarray(partStart + 2, headerEnd).toString('utf8');
    const body = raw.subarray(headerEnd + 4, bodyEnd);

    let disposition = '';
    let partType = 'application/octet-stream';
    for (const line of headerText.split('\r\n')) {
      const [rawName, ...rest] = line.split(':');
      const lowered = rawName?.trim().toLowerCase();
      if (lowered === 'content-disposition') disposition = rest.join(':');
      if (lowered === 'content-type') partType = rest.join(':').trim();
    }
    const { name, filename } = parseDisposition(disposition);
    if (name !== '') {
      if (filename === null) {
        fields.set(name, body.toString('utf8'));
      } else {
        if (body.length > UPLOAD_FILE_LIMIT) fail('payload_too_large');
        files.set(name, { filename, contentType: partType, data: body });
      }
    }
    if (next === -1) break;
    cursor = next;
  }

  return { fields, files };
}
