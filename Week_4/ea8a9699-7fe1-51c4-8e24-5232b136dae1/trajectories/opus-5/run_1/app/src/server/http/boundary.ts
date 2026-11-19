import type { IncomingMessage } from 'node:http';
import { errors } from '../errors.js';
import { limits } from '../../shared/limits.js';
import { isImageType, sniffMediaType, type MediaType } from '../domain/media.js';
import type { BodyKind } from './context.js';
import { boundaryOf, parseMultipart, type MultipartBody } from './multipart.js';

const blockedExact = new Set([
  '/package.json',
  '/package-lock.json',
  '/npm-shrinkwrap.json',
  '/yarn.lock',
  '/pnpm-lock.yaml',
  '/run.json',
  '/vite.config.ts',
  '/index.html',
]);

const blockedPrefixes = ['/src/', '/dist/', '/node_modules/', '/.env', '/.git', '/public/', '/tsconfig'];

/** Source files, lockfiles, server bundles and traversal attempts are unknown before any other check. */
export function isBlockedPath(path: string): boolean {
  const lowered = decodeURIComponent(path).toLowerCase();
  if (lowered.includes('..')) {
    return true;
  }
  if (blockedExact.has(lowered)) {
    return true;
  }
  return blockedPrefixes.some((prefix) => lowered.startsWith(prefix));
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function assertSameOrigin(method: string, headers: IncomingMessage['headers']): void {
  if (!unsafeMethods.has(method)) {
    return;
  }
  const origin = headers.origin;
  if (typeof origin !== 'string' || origin === '') {
    return;
  }
  const host = typeof headers.host === 'string' ? headers.host : '';
  if (origin === `http://${host}` || origin === `https://${host}`) {
    return;
  }
  throw errors.crossOrigin();
}

type UploadKind = 'reference' | 'still';

function uploadKindOf(path: string): UploadKind {
  return path.endsWith('/stills') ? 'still' : 'reference';
}

function multipartHardLimit(kind: UploadKind): number {
  return kind === 'still' ? limits.stillBytes : limits.clipBytes;
}

function limitFor(type: MediaType): number {
  return isImageType(type) ? limits.imageBytes : limits.clipBytes;
}

/** Judges the upload part's size and type at the boundary, before any other request check. */
function checkUploadPart(body: MultipartBody, kind: UploadKind): MediaType | null {
  const part = body.files.get(kind === 'still' ? 'still' : 'file');
  if (part === undefined) {
    return null;
  }
  if (part.content.length > multipartHardLimit(kind)) {
    throw errors.tooLarge();
  }
  const type = sniffMediaType(part.content);
  if (type === null) {
    if (part.content.length > limits.imageBytes) {
      throw errors.tooLarge();
    }
    throw errors.unsupportedMediaType();
  }
  if (kind === 'still' && type !== 'image/png') {
    throw errors.unsupportedMediaType();
  }
  if (kind === 'reference' && part.content.length > limitFor(type)) {
    throw errors.tooLarge();
  }
  return type;
}

async function readRaw(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBytes) {
      throw errors.tooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export interface ParsedBody {
  json: unknown;
  multipart: MultipartBody | null;
  uploadType: MediaType | null;
}

const multipartSlackBytes = 2_000_000;

export async function readBody(request: IncomingMessage, kind: BodyKind, path: string): Promise<ParsedBody> {
  const contentType = typeof request.headers['content-type'] === 'string' ? request.headers['content-type'] : '';
  const baseType = contentType.split(';')[0].trim().toLowerCase();

  if (kind === 'none') {
    return { json: undefined, multipart: null, uploadType: null };
  }

  if (kind === 'multipart') {
    if (baseType !== 'multipart/form-data') {
      throw errors.unsupportedMediaType();
    }
    const boundary = boundaryOf(contentType);
    if (boundary === null) {
      throw errors.unsupportedMediaType();
    }
    const uploadKind = uploadKindOf(path);
    const raw = await readRaw(request, multipartHardLimit(uploadKind) + multipartSlackBytes);
    const multipart = parseMultipart(raw, boundary);
    return { json: undefined, multipart, uploadType: checkUploadPart(multipart, uploadKind) };
  }

  if (baseType === '' && Number(request.headers['content-length'] ?? '0') === 0) {
    return { json: {}, multipart: null, uploadType: null };
  }
  if (baseType !== 'application/json') {
    throw errors.unsupportedMediaType();
  }
  const raw = await readRaw(request, limits.jsonBodyBytes);
  if (raw.length === 0) {
    return { json: {}, multipart: null, uploadType: null };
  }
  try {
    return { json: JSON.parse(raw.toString('utf8')), multipart: null, uploadType: null };
  } catch {
    throw errors.validation({});
  }
}
