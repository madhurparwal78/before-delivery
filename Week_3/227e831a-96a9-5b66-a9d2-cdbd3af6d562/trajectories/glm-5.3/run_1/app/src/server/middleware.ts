import type { FastifyRequest } from 'fastify';
import { payloadTooLarge, validationFailed } from './errors.js';

/**
 * The middleware chain, in the published error precedence order:
 * body limit → content type → cross-site → session → 404 → …
 */

/** Reads a parsed JSON buffer body and enforces the published limit. */
export function readJson(request: FastifyRequest, limit = 100_000): Record<string, unknown> {
  const body = request.body;
  if (body === undefined || body === null) return {};
  const bytes = body as Buffer;
  if (bytes.length > limit) throw payloadTooLarge();
  const text = bytes.toString('utf8');
  if (text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw validationFailed({ body: 'Send a JSON object.' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw validationFailed({ body: 'Send a JSON object.' });
  }
  return parsed as Record<string, unknown>;
}
