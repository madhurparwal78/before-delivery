import { FieldErrors } from '../errors';
import { FIELD_COPY } from '../../shared/copy';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** The accepted keys of a send. Everything else is refused field by field. */
export const SEND_FIELDS = ['client_message_id', 'text', 'thread_root_id', 'quoted_message_id'] as const;

/** The accepted keys of an edit. */
export const EDIT_FIELDS = ['text', 'expected_version'] as const;

export function collectUnacceptedKeys(
  providedKeys: readonly string[],
  accepted: readonly string[],
  errors: FieldErrors,
  extraAccepted: readonly string[] = [],
): void {
  for (const key of providedKeys) {
    if (accepted.includes(key) || extraAccepted.includes(key)) continue;
    errors.add(key, FIELD_COPY.unaccepted);
  }
}

export function parsePageLimit(raw: string | null, errors: FieldErrors): number {
  if (raw === null || raw === '') return 30;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    errors.add('limit', FIELD_COPY.limit);
    return 30;
  }
  return Math.min(value, 100);
}
