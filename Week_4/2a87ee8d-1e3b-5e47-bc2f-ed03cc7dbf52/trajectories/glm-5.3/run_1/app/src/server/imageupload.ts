/** Raw body reading for image uploads (DP-18, DP-19). */
import type { IncomingMessage } from 'node:http';
import { IMAGE_BODY_LIMIT, readBody } from './http.js';

export const IMAGE_BODY_LIMIT_VALUE = IMAGE_BODY_LIMIT;

export function imageKey(workshopId: string, imageId: string): string {
  return `workshops/${workshopId}/images/${imageId}`;
}

export function readRawBody(req: IncomingMessage): Promise<{ ok: true; buf: Buffer } | { ok: false; tooLarge: boolean }> {
  return readBody(req, IMAGE_BODY_LIMIT).then((r) => r.ok ? { ok: true as const, buf: r.buf } : { ok: false as const, tooLarge: r.tooLarge });
}
