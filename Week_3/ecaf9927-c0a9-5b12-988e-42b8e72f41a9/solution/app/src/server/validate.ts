import { invalid, staleRevision } from './errors';
import { FIELD_MESSAGES } from '../shared/messages';
import { FieldProblem } from '../shared/lengths';
import type { Queryable } from './db';
import { memberName } from './repo';

/** Collects field problems; each field keeps only its first. */
export class Validator {
  readonly fields: Record<string, string> = {};

  take<T>(field: string, parse: () => T): T | undefined {
    try {
      return parse();
    } catch (error) {
      if (error instanceof FieldProblem) {
        this.fail(field, error.message);
        return undefined;
      }
      throw error;
    }
  }

  fail(field: string, message: string): void {
    this.fields[field] ??= message;
  }

  /** Throws the one 422 when anything was wrong. */
  done(): void {
    if (Object.keys(this.fields).length > 0) throw invalid(this.fields);
  }
}

/** The revision a change started from, or undefined when it is not a whole number. */
function baseRevisionOf(input: unknown): number | undefined {
  const value = typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : input;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** The one revision check: a change that does not start from the current revision is refused and nothing changes. */
export async function requireCurrentRevision(
  q: Queryable,
  v: Validator,
  baseInput: unknown,
  record: { revision: number; savedBy: string },
  thing: string,
): Promise<void> {
  const base = baseRevisionOf(baseInput);
  if (base === undefined) {
    v.fail('base_revision', FIELD_MESSAGES.baseRevision);
  } else if (base !== record.revision) {
    const saver = await memberName(q, record.savedBy);
    throw staleRevision(saver.name, thing, record.revision, saver);
  }
}

/** A JSON request body that must be an object. */
export function objectBody(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** A name of 1 to 80 characters, trimmed. */
export function parseName(input: unknown): string {
  const name = typeof input === 'string' ? input.trim() : '';
  if (name.length < 1 || name.length > 80) throw new FieldProblem(FIELD_MESSAGES.nameLength);
  return name;
}
