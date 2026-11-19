import { FieldErrors } from '../errors';
import { FIELD_COPY } from '../../shared/copy';

/**
 * Cursors are opaque and mark the last item returned, so items added or
 * deleted elsewhere never cause a repeat or a skip.
 */
export function encodeCursor(parts: readonly string[]): string {
  return Buffer.from(parts.join('\u0000'), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | null, expectedParts: number, errors: FieldErrors): string[] | null {
  if (raw === null || raw === '') return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    errors.add('before', FIELD_COPY.before);
    return null;
  }
  const parts = decoded.split('\u0000');
  if (parts.length !== expectedParts) {
    errors.add('before', FIELD_COPY.before);
    return null;
  }
  return parts;
}
