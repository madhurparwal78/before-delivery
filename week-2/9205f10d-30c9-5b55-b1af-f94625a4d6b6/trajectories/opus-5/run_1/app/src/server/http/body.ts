import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.js';

export const JSON_BODY_LIMIT = 65_536;
export const UPLOAD_BODY_LIMIT = 5_250_000;

/** Reads the body, abandoning the stream as soon as the limit is passed. */
export function readBody(incoming: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    incoming.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        // Stop reading at the limit; the refusal is written and the socket then closed.
        incoming.pause();
        fail(new ApiError('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    incoming.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    incoming.on('error', fail);
    incoming.on('aborted', () => fail(new Error('Request aborted')));
  });
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonObject(raw: Buffer): JsonObject | null {
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    const value = parsed as JsonValue;
    return isJsonObject(value) ? value : null;
  } catch {
    return null;
  }
}
