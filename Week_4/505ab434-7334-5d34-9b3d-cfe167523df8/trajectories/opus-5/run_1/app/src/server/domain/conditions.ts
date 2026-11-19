import { CONDITION_INVALID_MESSAGES, errors } from '../errors.js';
import type { ConditionKind } from '../../shared/types.js';
import { formatDisplayDate } from '../time.js';

const CLEAR_SPACE_VALUES = ['0.5', '1', '1.5', '2'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface BuiltCondition {
  kind: ConditionKind;
  value: string | null;
  text: string;
}

/** Validates a condition value and prints its display text. */
export function buildCondition(kind: ConditionKind, rawValue: string | null): BuiltCondition {
  const value = (rawValue ?? '').trim();
  switch (kind) {
    case 'clear_space': {
      if (!CLEAR_SPACE_VALUES.includes(value)) throw errors.conditionInvalid(CONDITION_INVALID_MESSAGES.clear_space);
      return { kind, value, text: `Keep clear space of ${value}x the symbol height on every side.` };
    }
    case 'no_recolour':
      return { kind, value: null, text: 'Do not recolour the mark.' };
    case 'attribution': {
      if (value === '') throw errors.conditionInvalid(CONDITION_INVALID_MESSAGES.attribution);
      return { kind, value, text: `Credit line: ${value}` };
    }
    case 'proof_required':
      return { kind, value: null, text: 'Upload final artwork for approval before use.' };
    case 'territory': {
      const codes = value
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code !== '');
      if (codes.length === 0) throw errors.conditionInvalid(CONDITION_INVALID_MESSAGES.territory);
      return { kind, value: codes.join(', '), text: `Use only in: ${codes.join(', ')}` };
    }
    case 'expiry_override': {
      if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
        throw errors.conditionInvalid(CONDITION_INVALID_MESSAGES.expiry_override);
      }
      return { kind, value, text: `Use ends on ${formatDisplayDate(value)}.` };
    }
  }
}

export function isConditionKind(value: unknown): value is ConditionKind {
  return (
    value === 'clear_space' ||
    value === 'no_recolour' ||
    value === 'attribution' ||
    value === 'proof_required' ||
    value === 'territory' ||
    value === 'expiry_override'
  );
}
