import type { Member } from '../shared/api.js';
import {
  parseAngleDegrees,
  parseLength,
  parseToleranceText,
  type DisplayUnit,
  type LengthRole,
  type Tolerance,
} from '../shared/units.js';
import { errors, FIELD_MESSAGES, FieldErrors } from './errors.js';

export function requireFounder(member: Member): void {
  if (member.role !== 'founder') throw errors.forbidden();
}

const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,100}$/;

/**
 * Reads request fields, remembering the first problem per field, then raises one 422.
 * Placeholder values are returned for failed fields and never reach the domain, because
 * `done` throws first.
 */
export class Reader {
  private readonly fields = new FieldErrors();

  constructor(private readonly unit: DisplayUnit) {}

  length(raw: unknown, field: string, role: LengthRole = 'length'): number {
    const parsed = parseLength(raw, this.unit, role);
    if (parsed.ok) return parsed.mm;
    this.fields.add(
      field,
      parsed.reason === 'grammar'
        ? FIELD_MESSAGES.lengthGrammar
        : role === 'length'
          ? FIELD_MESSAGES.lengthRange
          : FIELD_MESSAGES.coordinateRange,
    );
    return Number.NaN;
  }

  angle(raw: unknown, field: string): number {
    const parsed = parseAngleDegrees(raw);
    if (parsed !== null) return parsed;
    this.fields.add(field, FIELD_MESSAGES.angle);
    return Number.NaN;
  }

  /** `undefined` when the field is absent, `null` when it clears the tolerance. */
  tolerance(raw: unknown): Tolerance | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (typeof raw === 'string') {
      const parsed = parseToleranceText(raw, this.unit);
      if (parsed === 'clear') return null;
      if (parsed === null) {
        this.fields.add('tolerance', FIELD_MESSAGES.tolerance);
        return null;
      }
      return parsed;
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      this.fields.add('tolerance', FIELD_MESSAGES.tolerance);
      return null;
    }
    const source = raw as Record<string, unknown>;
    if (source.kind === 'symmetric') {
      const value = parseLength(source.value, this.unit, 'coordinate');
      if (!value.ok || value.mm < 0) {
        this.fields.add('tolerance', FIELD_MESSAGES.tolerance);
        return null;
      }
      return { kind: 'symmetric', plus_mm: value.mm, minus_mm: value.mm };
    }
    if (source.kind === 'asymmetric') {
      const plus = parseLength(source.plus, this.unit, 'coordinate');
      const minus = parseLength(source.minus, this.unit, 'coordinate');
      if (!plus.ok || !minus.ok || plus.mm < 0 || minus.mm < 0) {
        this.fields.add('tolerance', FIELD_MESSAGES.tolerance);
        return null;
      }
      return { kind: 'asymmetric', plus_mm: plus.mm, minus_mm: minus.mm };
    }
    this.fields.add('tolerance', FIELD_MESSAGES.tolerance);
    return null;
  }

  baseRevision(raw: unknown): number {
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
    this.fields.add('base_revision', FIELD_MESSAGES.baseRevision);
    return Number.NaN;
  }

  name(raw: unknown, field = 'name'): string {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length >= 1 && trimmed.length <= 80) return trimmed;
    }
    this.fields.add(field, FIELD_MESSAGES.nameLength);
    return '';
  }

  nameTaken(field = 'name'): void {
    this.fields.add(field, FIELD_MESSAGES.nameTaken);
  }

  quantity(raw: unknown): number {
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 999) return raw;
    this.fields.add('quantity', FIELD_MESSAGES.quantity);
    return Number.NaN;
  }

  declaredMass(raw: unknown): number {
    const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000) {
      return value;
    }
    this.fields.add('declared_mass_g', FIELD_MESSAGES.declaredMass);
    return Number.NaN;
  }

  choice<T extends string>(raw: unknown, options: readonly T[], field: string): T {
    if (typeof raw === 'string' && (options as readonly string[]).includes(raw)) return raw as T;
    this.fields.add(field, FIELD_MESSAGES.choice);
    return options[0] as T;
  }

  materialId(raw: unknown, available: string[]): string {
    if (typeof raw === 'string' && available.includes(raw)) return raw;
    this.fields.add('material_id', FIELD_MESSAGES.materialId);
    return '';
  }

  precision(raw: unknown): number {
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4) return raw;
    this.fields.add('precision', FIELD_MESSAGES.choice);
    return 2;
  }

  componentFailed(): void {
    this.fields.add('component', FIELD_MESSAGES.component);
  }

  refsFailed(kindWord: string): void {
    this.fields.add('refs', FIELD_MESSAGES.refs(kindWord));
  }

  operationFailed(): void {
    this.fields.add('operation', FIELD_MESSAGES.operation);
  }

  add(field: string, message: string): void {
    this.fields.add(field, message);
  }

  done(): void {
    this.fields.throwIfAny();
  }
}

export function readIdempotencyKey(raw: string | undefined): string {
  if (raw !== undefined && IDEMPOTENCY_KEY_RE.test(raw)) return raw;
  throw errors.invalid({ idempotency_key: FIELD_MESSAGES.idempotencyKey });
}
