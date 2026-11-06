import type { IncomingMessage } from 'node:http';
import busboy from 'busboy';
import {
  crewMember,
  DEFAULT_ACTOR,
  MAX_JSON_BYTES,
  MAX_MULTIPART_BYTES,
  MAX_UPLOAD_BYTES,
} from '../../shared/domain.js';
import { fieldMessage } from '../../shared/copy.js';
import { apiError } from './errors.js';

export interface UploadPart {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

export interface Multipart {
  fields: Record<string, string>;
  file: UploadPart | null;
  /** True when the client went away before the whole file arrived. */
  interrupted: boolean;
}

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  method: string;
  body: Record<string, unknown>;
  multipart: Multipart | null;
  actor: string;
  /** Field errors found in headers, merged into the validation step. */
  headerFields: Record<string, string>;
  idempotencyKey: string | null;
}

export function checkOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw apiError.crossOrigin();
  }
  if (host !== req.headers.host) throw apiError.crossOrigin();
}

export function readActor(req: IncomingMessage): {
  actor: string;
  headerFields: Record<string, string>;
} {
  const raw = req.headers['x-crew-member'];
  if (raw === undefined) return { actor: DEFAULT_ACTOR, headerFields: {} };
  const handle = Array.isArray(raw) ? raw[0] : raw;
  if (handle === undefined || crewMember(handle) === undefined) {
    return {
      actor: DEFAULT_ACTOR,
      headerFields: { 'X-Crew-Member': fieldMessage.crewMember },
    };
  }
  return { actor: handle, headerFields: {} };
}

export function readIdempotencyKey(req: IncomingMessage): {
  key: string | null;
  headerFields: Record<string, string>;
} {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) return { key: null, headerFields: {} };
  const key = Array.isArray(raw) ? (raw[0] ?? '') : raw;
  if (!/^[\x21-\x7e]{1,100}$/.test(key)) {
    return {
      key: null,
      headerFields: { 'Idempotency-Key': fieldMessage.idempotencyKey },
    };
  }
  return { key, headerFields: {} };
}

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw apiError.payloadTooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) throw apiError.payloadTooLarge();
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(req, MAX_JSON_BYTES);
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim();
  if (type !== 'application/json') throw apiError.unsupportedMediaType();
  if (raw.length === 0) throw apiError.malformedJson();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw apiError.malformedJson();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw apiError.malformedJson();
  }
  return parsed as Record<string, unknown>;
}

export async function readMultipart(req: IncomingMessage): Promise<Multipart> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim();
  if (type !== 'multipart/form-data') throw apiError.unsupportedMediaType();
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > MAX_MULTIPART_BYTES) {
    throw apiError.payloadTooLarge();
  }

  return new Promise<Multipart>((resolve, reject) => {
    const parser = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 10 },
    });
    const result: Multipart = { fields: {}, file: null, interrupted: false };
    let tooLarge = false;
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_MULTIPART_BYTES) tooLarge = true;
    });
    req.on('aborted', () => {
      result.interrupted = true;
    });

    parser.on('field', (name, value) => {
      result.fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) tooLarge = true;
        else chunks.push(chunk);
      });
      stream.on('limit', () => {
        tooLarge = true;
      });
      stream.on('end', () => {
        if (name !== 'file') return;
        result.file = {
          fileName: info.filename ?? '',
          contentType: info.mimeType,
          bytes: Buffer.concat(chunks),
        };
      });
    });
    parser.on('error', () => {
      result.interrupted = true;
      resolve(result);
    });
    parser.on('close', () => {
      if (tooLarge) reject(apiError.payloadTooLarge());
      else resolve(result);
    });
    req.pipe(parser);
  });
}
