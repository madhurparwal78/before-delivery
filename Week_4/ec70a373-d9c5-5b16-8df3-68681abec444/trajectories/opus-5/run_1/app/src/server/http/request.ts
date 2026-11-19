import type { IncomingMessage } from 'node:http';
import { ApiError, validationError } from './errors';

export const JSON_BODY_LIMIT = 65536;
export const MULTIPART_REQUEST_LIMIT = 5500000;
export const FILE_PART_LIMIT = 5000000;
export const MAX_JSON_DEPTH = 20;

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let overLimit = false;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      /* The rest is drained, so the refusal still reaches the client. */
      overLimit = true;
      if (total > limit * 4) {
        request.destroy();
        break;
      }
      continue;
    }
    chunks.push(buffer);
  }
  if (overLimit) throw new ApiError('body_too_large');
  return Buffer.concat(chunks);
}

function jsonDepth(value: unknown, depth = 1): number {
  if (Array.isArray(value)) {
    let deepest = depth;
    for (const item of value) deepest = Math.max(deepest, jsonDepth(item, depth + 1));
    return deepest;
  }
  if (typeof value === 'object' && value !== null) {
    let deepest = depth;
    for (const item of Object.values(value)) deepest = Math.max(deepest, jsonDepth(item, depth + 1));
    return deepest;
  }
  return depth;
}

export function parseJsonBody(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw validationError({ body: 'Send a JSON object.' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw validationError({ body: 'Send a JSON object.' });
  }
  if (jsonDepth(parsed) > MAX_JSON_DEPTH) {
    throw validationError({ body: 'That body is nested too deeply.' });
  }
  return parsed as Record<string, unknown>;
}

export interface MultipartFile {
  fieldName: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: MultipartFile[];
  fieldNames: string[];
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split('\r\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function headerParameter(value: string, name: string): string | null {
  const quoted = new RegExp(`${name}="([^"]*)"`).exec(value);
  if (quoted !== null) return quoted[1] as string;
  const bare = new RegExp(`${name}=([^;]+)`).exec(value);
  return bare === null ? null : (bare[1] as string).trim();
}

export function parseMultipart(raw: Buffer, contentType: string): MultipartBody {
  const boundary = headerParameter(contentType, 'boundary');
  if (boundary === null) throw new ApiError('unsupported_media_type');
  const delimiter = Buffer.from(`--${boundary}`);
  const body: MultipartBody = { fields: {}, files: [], fieldNames: [] };
  let position = raw.indexOf(delimiter);
  if (position === -1) throw validationError({ file: 'Choose a file to upload.' });
  position += delimiter.length;
  while (position < raw.length) {
    if (raw.slice(position, position + 2).toString('latin1') === '--') break;
    if (raw.slice(position, position + 2).toString('latin1') === '\r\n') position += 2;
    const headerEnd = raw.indexOf('\r\n\r\n', position, 'latin1');
    if (headerEnd === -1) break;
    const headers = parseHeaders(raw.slice(position, headerEnd).toString('utf8'));
    const disposition = headers['content-disposition'] ?? '';
    const fieldName = headerParameter(disposition, 'name') ?? '';
    const fileName = headerParameter(disposition, 'filename');
    const contentStart = headerEnd + 4;
    let contentEnd = raw.indexOf(delimiter, contentStart);
    if (contentEnd === -1) contentEnd = raw.length;
    let dataEnd = contentEnd;
    if (raw.slice(dataEnd - 2, dataEnd).toString('latin1') === '\r\n') dataEnd -= 2;
    const bytes = raw.slice(contentStart, dataEnd);
    body.fieldNames.push(fieldName);
    if (fileName === null) {
      body.fields[fieldName] = bytes.toString('utf8');
    } else {
      if (bytes.length > FILE_PART_LIMIT) throw new ApiError('file_too_large');
      body.files.push({
        fieldName,
        fileName,
        contentType: headers['content-type'] ?? 'application/octet-stream',
        bytes,
      });
    }
    position = contentEnd + delimiter.length;
  }
  return body;
}

/** Every body is closed: any key the endpoint does not list is refused by name. */
export function closedBody(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    const fields: Record<string, string> = {};
    for (const name of unknown) fields[name] = 'Unknown field.';
    throw validationError(fields);
  }
}

export function closedForm(body: MultipartBody, allowed: readonly string[]): void {
  const unknown = body.fieldNames.filter((name) => !allowed.includes(name));
  if (unknown.length > 0) {
    const fields: Record<string, string> = {};
    for (const name of unknown) fields[name] = 'Unknown field.';
    throw validationError(fields);
  }
}

export function requireString(
  body: Record<string, unknown>,
  name: string,
  options: { min?: number; max?: number; message?: string } = {},
): string {
  const value = body[name];
  if (typeof value !== 'string') {
    throw validationError({ [name]: options.message ?? 'Give a value.' });
  }
  if (options.min !== undefined && value.length < options.min) {
    throw validationError({ [name]: options.message ?? 'Give a value.' });
  }
  if (options.max !== undefined && value.length > options.max) {
    throw validationError({ [name]: options.message ?? 'That value is too long.' });
  }
  return value;
}

export function requireInteger(
  body: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
  message: string,
): number {
  const value = body[name];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw validationError({ [name]: message });
  }
  return value;
}

export const EMAIL_MAX = 254;

/** The published email rule, used by sign-in and by inspector links. */
export function isEmail(value: string): boolean {
  if (value.length < 3 || value.length > EMAIL_MAX) return false;
  if (/\s/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0) return false;
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
