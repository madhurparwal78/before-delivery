import type { IncomingMessage } from 'node:http';
import busboy from 'busboy';
import { malformedBody, payloadTooLarge } from './errors';

export const JSON_BODY_LIMIT = 65_536;
export const UPLOAD_BODY_LIMIT = 6_000_000;

export async function readRawBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(payloadTooLarge());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', () => reject(malformedBody()));
  });
}

export function parseJsonBody(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  const text = raw.toString('utf8').trim();
  if (text === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw malformedBody();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw malformedBody();
  return parsed as Record<string, unknown>;
}

export interface MultipartFile {
  bytes: Buffer;
  truncated: boolean;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
  names: string[];
}

export const FILE_PART_LIMIT = 5_000_000;

export async function readMultipartBody(request: IncomingMessage): Promise<MultipartBody> {
  return new Promise<MultipartBody>((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: request.headers,
        limits: { fileSize: FILE_PART_LIMIT + 1, files: 4, fields: 20, fieldSize: 10_000 },
      });
    } catch {
      reject(malformedBody());
      return;
    }
    const body: MultipartBody = { fields: {}, files: {}, names: [] };
    let settled = false;

    parser.on('field', (name, value) => {
      body.names.push(name);
      body.fields[name] = value;
    });
    parser.on('file', (name, stream) => {
      body.names.push(name);
      const chunks: Buffer[] = [];
      let truncated = false;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('end', () => {
        body.files[name] = { bytes: Buffer.concat(chunks), truncated };
      });
    });
    parser.on('error', () => {
      if (settled) return;
      settled = true;
      reject(malformedBody());
    });
    parser.on('close', () => {
      if (settled) return;
      settled = true;
      resolve(body);
    });
    request.on('error', () => {
      if (settled) return;
      settled = true;
      reject(malformedBody());
    });
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > UPLOAD_BODY_LIMIT && !settled) {
        settled = true;
        reject(payloadTooLarge());
        request.destroy();
      }
    });
    request.pipe(parser);
  });
}
