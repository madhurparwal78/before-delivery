import busboy from 'busboy';
import type { IncomingMessage } from 'node:http';
import { ApiError } from '../errors.ts';

export const JSON_BODY_LIMIT = 65_536;
export const ENQUIRY_BODY_LIMIT = 10_500_000;
export const STEM_BODY_LIMIT = 20_500_000;

function tooLarge(): ApiError {
  return new ApiError(413, 'payload_too_large', 'That request body is too large.');
}

export async function readRawBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > limit) throw tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(raw: Buffer): Record<string, unknown> {
  if (raw.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'malformed_json', 'That request body is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'malformed_json', 'That request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export type UploadedFile = {
  field: string;
  filename: string;
  bytes: Buffer;
};

export type MultipartBody = {
  fields: Record<string, string>;
  file: UploadedFile | null;
};

export async function parseMultipartBody(request: IncomingMessage, limit: number): Promise<MultipartBody> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw tooLarge();

  return new Promise<MultipartBody>((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: request.headers,
        limits: { files: 1, fields: 20 },
        // The uploaded name is checked as it was sent, so busboy must not strip its path.
        preservePath: true,
      });
    } catch {
      reject(new ApiError(400, 'malformed_json', 'That request body is not a valid multipart body.'));
      return;
    }
    const fields: Record<string, string> = {};
    let file: UploadedFile | null = null;
    let settled = false;
    let total = 0;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      request.unpipe(parser);
      request.resume();
      reject(error);
    };

    request.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > limit) fail(tooLarge());
    });

    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        file = { field: name, filename: info.filename ?? '', bytes: Buffer.concat(chunks) };
      });
      stream.on('error', fail);
    });
    parser.on('error', () => fail(new ApiError(400, 'malformed_json', 'That multipart body could not be read.')));
    parser.on('close', () => {
      if (settled) return;
      settled = true;
      resolve({ fields, file });
    });

    request.pipe(parser);
  });
}
