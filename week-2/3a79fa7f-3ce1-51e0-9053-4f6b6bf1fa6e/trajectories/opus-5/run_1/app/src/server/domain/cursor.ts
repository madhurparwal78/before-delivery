import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { failValidation } from '../errors.js';

const key = createHash('sha256').update(`tern-foils-cursor:${config.databaseUrl}`).digest();

/** An opaque cursor marking the position after the last order of a page. */
export function encodeCursor(orderNumber: string): string {
  const signature = createHmac('sha256', key).update(orderNumber).digest('base64url').slice(0, 22);
  return Buffer.from(`${orderNumber}.${signature}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = decoded.lastIndexOf('.');
  if (split < 0) failValidation({ cursor: 'This page link is invalid.' });
  const orderNumber = decoded.slice(0, split);
  const signature = decoded.slice(split + 1);
  const expected = createHmac('sha256', key).update(orderNumber).digest('base64url').slice(0, 22);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    failValidation({ cursor: 'This page link is invalid.' });
  }
  return orderNumber;
}

export function parseLimit(raw: string | null): number {
  if (raw === null) return 20;
  if (!/^[0-9]+$/.test(raw)) failValidation({ limit: 'Choose 1 to 50.' });
  const limit = Number(raw);
  if (limit < 1 || limit > 50) failValidation({ limit: 'Choose 1 to 50.' });
  return limit;
}
