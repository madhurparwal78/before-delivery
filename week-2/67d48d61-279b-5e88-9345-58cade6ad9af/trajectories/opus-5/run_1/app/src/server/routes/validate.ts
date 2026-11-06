import { fieldMessage } from '../../shared/copy.js';
import {
  crewMember,
  department,
  MAX_DETAILS_LENGTH,
  MAX_TITLE_LENGTH,
  STATUSES,
  taskNumber,
  type CycleKey,
  type Priority,
  type Status,
} from '../../shared/domain.js';
import { currentCycleKey, cyclePosition, type CycleRow } from '../cycles.js';
import { apiError } from '../http/errors.js';

export type Fields = Record<string, string>;

export function refuseIfAny(fields: Fields): void {
  if (Object.keys(fields).length > 0) throw apiError.validation(fields);
}

export function parseTitle(value: unknown, fields: Fields, key = 'title'): string | undefined {
  const empty = key === 'title' ? fieldMessage.titleEmpty : fieldMessage.requestTitleEmpty;
  if (typeof value !== 'string' || value.trim().length === 0) {
    fields[key] = empty;
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    fields[key] = fieldMessage.titleLong;
    return undefined;
  }
  return trimmed;
}

export function parseDetails(value: unknown, fields: Fields): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_DETAILS_LENGTH) {
    fields.details = fieldMessage.details;
    return undefined;
  }
  return value;
}

export function parseDepartment(value: unknown, fields: Fields): string | undefined {
  if (typeof value !== 'string' || department(value) === undefined) {
    fields.department = fieldMessage.department;
    return undefined;
  }
  return value;
}

export function parsePriority(value: unknown, fields: Fields): Priority | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4) {
    fields.priority = fieldMessage.priority;
    return undefined;
  }
  return value as Priority;
}

export function parseOwner(value: unknown, fields: Fields): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || crewMember(value) === undefined) {
    fields.owner = fieldMessage.owner;
    return undefined;
  }
  return value;
}

export function parseStatus(value: unknown, fields: Fields): Status | undefined {
  if (typeof value !== 'string' || !(STATUSES as readonly string[]).includes(value)) {
    fields.status = fieldMessage.status;
    return undefined;
  }
  return value as Status;
}

export function parseLabel(
  value: unknown,
  departmentKey: string | null,
  fields: Fields,
): string | null | undefined {
  if (value === null) return null;
  const labels = department(departmentKey)?.labels ?? [];
  if (typeof value !== 'string' || !labels.some((label) => label.key === value)) {
    fields.label = fieldMessage.label;
    return undefined;
  }
  return value;
}

/** The current cycle or a later one. */
export function parseCycle(
  value: unknown,
  cycles: CycleRow[],
  now: Date,
  fields: Fields,
): CycleKey | undefined {
  const keys = cycles.map((cycle) => cycle.key);
  if (typeof value !== 'string' || !keys.includes(value as CycleKey)) {
    fields.cycle = fieldMessage.cycle;
    return undefined;
  }
  const current = currentCycleKey(cycles, now);
  if (cyclePosition(cycles, value as CycleKey) < cyclePosition(cycles, current)) {
    fields.cycle = fieldMessage.cycle;
    return undefined;
  }
  return value as CycleKey;
}

export function parseTaskRef(value: unknown, fields: Fields, key: string): number | undefined {
  const message = key === 'parent' ? fieldMessage.parent : fieldMessage.blocksUnknown;
  if (typeof value !== 'string') {
    fields[key] = message;
    return undefined;
  }
  const number = taskNumber(value);
  if (number === null) {
    fields[key] = message;
    return undefined;
  }
  return number;
}
