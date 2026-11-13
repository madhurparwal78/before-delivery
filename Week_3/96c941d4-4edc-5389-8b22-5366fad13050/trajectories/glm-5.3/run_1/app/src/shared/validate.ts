import { LIMITS, DEVICES, CREATURES, Difficulty, DeviceId, CreatureId } from './seed.js';

export type FieldErrors = Record<string, string>;

export const FIELD_MESSAGE = 'Use a permitted value.';

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Rejects Cc, U+0085 and U+2028 before trimming. */
export function hasForbiddenCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true; // Cc plus U+0085
    if (c === 0x2028) return true;
  }
  return false;
}

export function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 >= text.length) return true;
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export const DIFFICULTIES: Difficulty[] = ['calm', 'rough', 'severe'];
export const DEVICE_IDS: DeviceId[] = DEVICES.map((d) => d.id);
export const CREATURE_IDS: CreatureId[] = CREATURES.map((c) => c.id);

/** Rejects unknown members of a known object shape. */
export function rejectUnknownMembers(value: Record<string, unknown>, allowed: string[], path: string, errors: FieldErrors): boolean {
  let ok = true;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors[`${path}${path === '' ? '' : '.'}${key}`] = FIELD_MESSAGE;
      ok = false;
    }
  }
  return ok;
}

export interface DefinitionValidationResult {
  valid: boolean;
  errors: FieldErrors;
  definition?: {
    title: string;
    description: string;
    difficulty: Difficulty;
    seed: number;
    buildable: Array<{ lane: number; cell: number }>;
    waves: Array<{ tick: number; creature: CreatureId; count: number; interval: number; lane: number }>;
  };
}

/** Validates a Definition object at path `path`; appends errors and returns normalized values or undefined. */
export function validateDefinition(value: unknown, path: string, errors: FieldErrors): DefinitionValidationResult['definition'] {
  if (!isObject(value)) {
    errors[path] = FIELD_MESSAGE;
    return undefined;
  }
  const before = Object.keys(errors).length;
  rejectUnknownMembers(value, ['title', 'description', 'difficulty', 'seed', 'buildable', 'waves'], path, errors);
  const titleRaw = value.title;
  let title = '';
  if (typeof titleRaw !== 'string' || hasForbiddenCharacters(titleRaw) || hasUnpairedSurrogate(titleRaw)) {
    errors[`${path}.title`] = FIELD_MESSAGE;
  } else {
    title = titleRaw.trim();
    const length = codePoints(title);
    if (length < LIMITS.minTitleCodePoints || length > LIMITS.maxTitleCodePoints) {
      errors[`${path}.title`] = FIELD_MESSAGE;
    }
  }
  const descriptionRaw = value.description;
  let description = '';
  if (typeof descriptionRaw !== 'string' || hasForbiddenCharacters(descriptionRaw) || hasUnpairedSurrogate(descriptionRaw)) {
    errors[`${path}.description`] = FIELD_MESSAGE;
  } else {
    description = descriptionRaw.trim();
    if (codePoints(description) > LIMITS.maxDescriptionCodePoints) {
      errors[`${path}.description`] = FIELD_MESSAGE;
    }
  }
  const difficulty = value.difficulty;
  if (typeof difficulty !== 'string' || !DIFFICULTIES.includes(difficulty as Difficulty)) {
    errors[`${path}.difficulty`] = FIELD_MESSAGE;
  }
  const seed = value.seed;
  if (!isInteger(seed) || seed < LIMITS.minSeed || seed > LIMITS.maxSeed) {
    errors[`${path}.seed`] = FIELD_MESSAGE;
  }
  const buildableRaw = value.buildable;
  const buildable: Array<{ lane: number; cell: number }> = [];
  if (!Array.isArray(buildableRaw)) {
    errors[`${path}.buildable`] = FIELD_MESSAGE;
  } else {
    const seen = new Set<string>();
    buildableRaw.forEach((pair, index) => {
      if (!isObject(pair)) {
        errors[`${path}.buildable[${index}]`] = FIELD_MESSAGE;
        return;
      }
      const lane = pair.lane;
      const cell = pair.cell;
      if (!isInteger(lane) || !isInteger(cell) || lane < 1 || lane > LIMITS.lanes || cell < 1 || cell > LIMITS.cellsPerLane) {
        errors[`${path}.buildable[${index}]`] = FIELD_MESSAGE;
        return;
      }
      const key = `${lane}:${cell}`;
      if (seen.has(key)) {
        errors[`${path}.buildable[${index}]`] = FIELD_MESSAGE;
        return;
      }
      seen.add(key);
      buildable.push({ lane, cell });
    });
  }
  const wavesRaw = value.waves;
  const waves: Array<{ tick: number; creature: CreatureId; count: number; interval: number; lane: number }> = [];
  let totalCreatures = 0;
  if (!Array.isArray(wavesRaw)) {
    errors[`${path}.waves`] = FIELD_MESSAGE;
  } else if (wavesRaw.length < LIMITS.minWaves || wavesRaw.length > LIMITS.maxWaves) {
    errors[`${path}.waves`] = FIELD_MESSAGE;
  } else {
    wavesRaw.forEach((wave, index) => {
      if (!isObject(wave)) {
        errors[`${path}.waves[${index}]`] = FIELD_MESSAGE;
        return;
      }
      rejectUnknownMembers(wave, ['tick', 'creature', 'count', 'interval', 'lane'], `${path}.waves[${index}]`, errors);
      const tick = wave.tick;
      const creature = wave.creature;
      const count = wave.count;
      const interval = wave.interval;
      const lane = wave.lane;
      if (!isInteger(tick) || typeof creature !== 'string' || !isInteger(count) || !isInteger(interval) || !isInteger(lane)) {
        errors[`${path}.waves[${index}]`] = FIELD_MESSAGE;
        return;
      }
      if (
        tick < LIMITS.minWaveTick ||
        count < LIMITS.minWaveCount ||
        interval < LIMITS.minWaveInterval ||
        lane < 0 ||
        lane > LIMITS.maxWaveLane ||
        !CREATURE_IDS.includes(creature as CreatureId)
      ) {
        errors[`${path}.waves[${index}]`] = FIELD_MESSAGE;
        return;
      }
      // The last scheduled spawn must stay within command-tick bounds.
      if (tick + (count - 1) * interval > LIMITS.maxCommandTick) {
        errors[`${path}.waves[${index}]`] = FIELD_MESSAGE;
        return;
      }
      totalCreatures += count;
      waves.push({ tick, creature: creature as CreatureId, count, interval, lane });
    });
    if (Object.keys(errors).length === before && totalCreatures > LIMITS.maxCreatures) {
      errors[`${path}.waves`] = FIELD_MESSAGE;
    }
  }
  if (Object.keys(errors).length > before) {
    return undefined;
  }
  buildable.sort((a, b) => a.lane - b.lane || a.cell - b.cell);
  return {
    title,
    description,
    difficulty: difficulty as Difficulty,
    seed: seed as number,
    buildable,
    waves,
  };
}
