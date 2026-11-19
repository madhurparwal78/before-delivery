import { base64urlDecode, base64urlEncode, fromText, decodeLossy } from './bytes.js';
import {
  argLabel,
  argValueText,
  findOperation,
  normalizeArgs,
  validateArg,
  type ArgValue,
  type Args,
} from './ops.js';

export interface RecipeStep {
  op: string;
  args: Args;
  disabled: boolean;
  breakpoint: boolean;
}

export const NAME_MAX = 80;
export const NOTE_MAX = 200;
export const TAGS_MAX = 10;
export const STEPS_MAX = 100;
export const TAG_PATTERN = /^[a-z0-9-]{1,30}$/;

export const TAGS_MESSAGE = 'Tags need 1 to 30 lowercase letters, digits or hyphens each, 10 at most.';

export type FieldErrors = Record<string, string>;

export interface RecipeDraft {
  name: string;
  note: string;
  tags: string[];
  steps: RecipeStep[];
}

/** Splits the Tags textbox value into tags, trimming whitespace and dropping empty entries. */
export function parseTagList(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates steps from an untrusted body, collecting 422 field messages. */
export function validateSteps(value: unknown, errors: FieldErrors, prefix = 'steps'): RecipeStep[] {
  if (!Array.isArray(value)) {
    errors[prefix] = 'Steps must be a list.';
    return [];
  }
  if (value.length > STEPS_MAX) {
    errors[prefix] = `A recipe can hold at most ${STEPS_MAX} steps.`;
    return [];
  }
  const steps: RecipeStep[] = [];
  value.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      errors[`${prefix}.${index}`] = 'A step must be an object.';
      return;
    }
    const name = raw['op'];
    if (typeof name !== 'string') {
      errors[`${prefix}.${index}.op`] = 'A step needs an operation name.';
      return;
    }
    const op = findOperation(name);
    if (op === undefined) {
      errors[`${prefix}.${index}.op`] = `Unknown operation '${name}'.`;
      return;
    }
    const givenArgs = isPlainObject(raw['args']) ? (raw['args'] as Args) : undefined;
    const args = normalizeArgs(op, givenArgs);
    for (const spec of op.args) {
      const message = validateArg(spec, args[spec.key] as ArgValue);
      if (message !== null) errors[`${prefix}.${index}.args.${spec.key}`] = message;
    }
    const disabled = raw['disabled'];
    const breakpoint = raw['breakpoint'];
    if (disabled !== undefined && typeof disabled !== 'boolean') {
      errors[`${prefix}.${index}.disabled`] = 'Disabled must be true or false.';
    }
    if (breakpoint !== undefined && typeof breakpoint !== 'boolean') {
      errors[`${prefix}.${index}.breakpoint`] = 'Breakpoint must be true or false.';
    }
    steps.push({ op: op.name, args, disabled: disabled === true, breakpoint: breakpoint === true });
  });
  return steps;
}

export function validateName(value: unknown, errors: FieldErrors, field = 'name'): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > NAME_MAX) {
    errors[field] = `A name needs 1 to ${NAME_MAX} characters.`;
    return typeof value === 'string' ? value : '';
  }
  return value;
}

export function validateNote(value: unknown, errors: FieldErrors): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > NOTE_MAX) {
    errors['note'] = `A note can hold at most ${NOTE_MAX} characters.`;
    return '';
  }
  return value;
}

export function validateTags(value: unknown, errors: FieldErrors): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > TAGS_MAX) {
    errors['tags'] = TAGS_MESSAGE;
    return [];
  }
  const tags: string[] = [];
  for (const tag of value) {
    if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
      errors['tags'] = TAGS_MESSAGE;
      return [];
    }
    tags.push(tag);
  }
  return tags;
}

/** The compact steps form carried in a recipe link. */
export function compactSteps(steps: readonly RecipeStep[]): string {
  const compact = steps.map((step) => {
    const op = findOperation(step.op)!;
    const args = normalizeArgs(op, step.args);
    const ordered: Record<string, ArgValue> = {};
    for (const spec of op.args) ordered[spec.key] = args[spec.key] as ArgValue;
    const entry: Record<string, unknown> = { op: step.op, args: ordered };
    if (step.disabled) entry['disabled'] = true;
    if (step.breakpoint) entry['breakpoint'] = true;
    return entry;
  });
  return JSON.stringify(compact);
}

export function buildRecipeLink(steps: readonly RecipeStep[], input: Uint8Array): string {
  return `/w#r=${base64urlEncode(fromText(compactSteps(steps)))}&i=${base64urlEncode(input)}`;
}

export type LinkPart = 'recipe' | 'input';

export interface ParsedLink {
  steps: RecipeStep[];
  input: Uint8Array;
}

/** Reads a /w#r=…&i=… fragment. Returns the damaged part when it cannot be read. */
export function parseRecipeLink(fragment: string): ParsedLink | LinkPart {
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const recipePart = params.get('r') ?? '';
  const inputPart = params.get('i') ?? '';
  const recipeBytes = base64urlDecode(recipePart);
  if (recipeBytes === null) return 'recipe';
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeLossy(recipeBytes));
  } catch {
    return 'recipe';
  }
  const errors: FieldErrors = {};
  const steps = validateSteps(parsed, errors);
  if (Object.keys(errors).length > 0) return 'recipe';
  const input = base64urlDecode(inputPart);
  if (input === null) return 'input';
  return { steps, input };
}

interface ComparableStep {
  op: string;
  args: Args;
  disabled: boolean;
}

export interface CompareVersion {
  name: string;
  steps: readonly ComparableStep[];
}

/** The one place that matches steps between two versions and writes the change lines. */
export function compareVersions(from: CompareVersion, to: CompareVersion): string[] {
  const oldSteps = from.steps;
  const newSteps = to.steps;
  const rows = oldSteps.length;
  const columns = newSteps.length;
  const lengths: number[][] = [];
  for (let i = 0; i <= rows; i += 1) lengths.push(new Array<number>(columns + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        oldSteps[i]!.op === newSteps[j]!.op
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const pairOldForNew = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (oldSteps[i]!.op === newSteps[j]!.op && lengths[i]![j]! === lengths[i + 1]![j + 1]! + 1) {
      pairOldForNew.set(j, i);
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! > lengths[i]![j + 1]!) {
      i += 1;
    } else {
      // A tie keeps the earlier old step available to match.
      j += 1;
    }
  }
  const matchedOld = new Set(pairOldForNew.values());
  const movedForNew = new Map<number, number>();
  const leftoverOld = new Map<string, number[]>();
  for (let index = 0; index < rows; index += 1) {
    if (matchedOld.has(index)) continue;
    const list = leftoverOld.get(oldSteps[index]!.op) ?? [];
    list.push(index);
    leftoverOld.set(oldSteps[index]!.op, list);
  }
  for (let index = 0; index < columns; index += 1) {
    if (pairOldForNew.has(index)) continue;
    const list = leftoverOld.get(newSteps[index]!.op);
    const oldIndex = list?.shift();
    if (oldIndex !== undefined) {
      movedForNew.set(index, oldIndex);
      matchedOld.add(oldIndex);
    }
  }

  const lines: string[] = [];
  if (from.name !== to.name) lines.push(`Renamed from ${from.name} to ${to.name}`);
  for (let index = 0; index < rows; index += 1) {
    if (matchedOld.has(index)) continue;
    lines.push(`Removed ${oldSteps[index]!.op} from step ${index + 1}`);
  }
  for (let index = 0; index < columns; index += 1) {
    const step = newSteps[index]!;
    const number = index + 1;
    const oldIndex = pairOldForNew.get(index) ?? movedForNew.get(index);
    if (oldIndex === undefined) {
      lines.push(`Added ${step.op} at step ${number}`);
      continue;
    }
    if (movedForNew.has(index) && oldIndex + 1 !== number) {
      lines.push(`Moved ${step.op} from step ${oldIndex + 1} to step ${number}`);
    }
    const before = oldSteps[oldIndex]!;
    const op = findOperation(step.op);
    if (op !== undefined) {
      const beforeArgs = normalizeArgs(op, before.args);
      const afterArgs = normalizeArgs(op, step.args);
      for (const spec of op.args) {
        const was = beforeArgs[spec.key] as ArgValue;
        const now = afterArgs[spec.key] as ArgValue;
        if (was !== now) {
          lines.push(
            `Changed ${step.op} at step ${number}: ${argLabel(op, spec.key)} from ${argValueText(was)} to ${argValueText(now)}`,
          );
        }
      }
    }
    if (before.disabled !== step.disabled) {
      lines.push(`${step.disabled ? 'Disabled' : 'Enabled'} ${step.op} at step ${number}`);
    }
  }
  return lines;
}
