import { MICRO_PER_UNIT_SCALE } from './money';

export type InputValues = Readonly<Record<string, string | number>>;

function integerOf(values: InputValues, key: string): bigint {
  const value = values[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Input ${key} must be an integer to compute units`);
  }
  return BigInt(value);
}

function textOf(values: InputValues, key: string): string {
  const value = values[key];
  if (typeof value !== 'string') throw new Error(`Input ${key} must be text to compute units`);
  return value;
}

/** Estimated units, scaled by 1e6, following each model's published unit rule. */
export function estimatedUnitsMicro(slug: string, values: InputValues): bigint {
  switch (slug) {
    case 'quill-still':
      return integerOf(values, 'num_images') * MICRO_PER_UNIT_SCALE;
    case 'halftone-xl':
      return integerOf(values, 'width') * integerOf(values, 'height') * integerOf(values, 'num_images');
    case 'reel-10':
      return integerOf(values, 'duration_seconds') * MICRO_PER_UNIT_SCALE;
    case 'murmur-voice':
      return integerOf(values, 'max_seconds') * MICRO_PER_UNIT_SCALE;
    default:
      throw new Error(`No unit rule for model ${slug}`);
  }
}

/** Billed units, scaled by 1e6, following each model's published unit rule. */
export function billedUnitsMicro(slug: string, values: InputValues, estimatedUnits: bigint): bigint {
  if (slug !== 'murmur-voice') return estimatedUnits;
  const maxSeconds = integerOf(values, 'max_seconds');
  const characters = BigInt([...textOf(values, 'text')].length);
  const spokenSeconds = (characters + 14n) / 15n;
  const billed = spokenSeconds < maxSeconds ? spokenSeconds : maxSeconds;
  return billed * MICRO_PER_UNIT_SCALE;
}

/** How many output objects a run writes, and their shape. */
export interface OutputPlan {
  mediaType: string;
  extension: 'png' | 'jpg' | 'webp' | 'webm' | 'wav';
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export function outputPlan(slug: string, values: InputValues, billedUnitsMicroValue: bigint): OutputPlan[] {
  switch (slug) {
    case 'quill-still': {
      const count = Number(integerOf(values, 'num_images'));
      return Array.from({ length: count }, () => ({
        mediaType: 'image/png',
        extension: 'png' as const,
        width: 1024,
        height: 1024,
        durationSeconds: null,
      }));
    }
    case 'halftone-xl': {
      const count = Number(integerOf(values, 'num_images'));
      const width = Number(integerOf(values, 'width'));
      const height = Number(integerOf(values, 'height'));
      return Array.from({ length: count }, () => ({
        mediaType: 'image/png',
        extension: 'png' as const,
        width,
        height,
        durationSeconds: null,
      }));
    }
    case 'reel-10':
      return [
        {
          mediaType: 'video/webm',
          extension: 'webm',
          width: 1280,
          height: 720,
          durationSeconds: Number(integerOf(values, 'duration_seconds')),
        },
      ];
    case 'murmur-voice':
      return [
        {
          mediaType: 'audio/wav',
          extension: 'wav',
          width: null,
          height: null,
          durationSeconds: Number(billedUnitsMicroValue / MICRO_PER_UNIT_SCALE),
        },
      ];
    default:
      throw new Error(`No output plan for model ${slug}`);
  }
}
