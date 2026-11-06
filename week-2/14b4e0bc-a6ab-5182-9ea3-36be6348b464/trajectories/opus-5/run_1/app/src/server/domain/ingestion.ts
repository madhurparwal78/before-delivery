import {
  type AssetKind,
  type Transform,
  ASSET_KINDS,
  TRANSFORMS,
  codePointLength,
} from '../../shared/domain.ts';

const ASSET_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^\p{L}[\p{L}\p{M}\p{Nd}_]*$/u;

export function isValidAssetId(id: string): boolean {
  return ASSET_ID_PATTERN.test(id) && id.length <= 120;
}

export function isValidKind(kind: unknown): kind is AssetKind {
  return typeof kind === 'string' && ASSET_KINDS.includes(kind as AssetKind);
}

export function isValidTransform(transform: unknown): transform is Transform {
  return typeof transform === 'string' && TRANSFORMS.includes(transform as Transform);
}

/**
 * A column name is 1 to 60 code points of letters in any script, combining marks, decimal
 * digits and underscore, starts with a letter, and holds no uppercase or titlecase letter.
 */
export function isValidColumnName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const length = codePointLength(name);
  if (length < 1 || length > 60) return false;
  if (!COLUMN_NAME_PATTERN.test(name)) return false;
  return !/\p{Lu}|\p{Lt}/u.test(name);
}

export interface ColumnInput {
  name: string;
  data_type: string;
  samples: string[];
}

export function isValidColumnInput(value: unknown): value is ColumnInput {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (!isValidColumnName(candidate.name)) return false;
  if (typeof candidate.data_type !== 'string') return false;
  const typeLength = codePointLength(candidate.data_type);
  if (typeLength < 1 || typeLength > 40) return false;
  const samples = candidate.samples;
  if (samples !== undefined) {
    if (!Array.isArray(samples) || samples.length > 5) return false;
    if (samples.some((sample) => typeof sample !== 'string' || codePointLength(sample) > 200)) {
      return false;
    }
  }
  return true;
}
