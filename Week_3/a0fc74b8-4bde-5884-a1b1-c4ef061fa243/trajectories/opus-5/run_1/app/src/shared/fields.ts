import { KIND_WORD } from './copy.ts';
import type { FieldKind } from './types.ts';

export interface FieldValueShape {
  kind: FieldKind;
  value: string | null;
}

/** The one place that decides whether a signer's field holds a value. */
export const isFieldComplete = (field: FieldValueShape): boolean => {
  if (field.value === null) return false;
  if (field.kind === 'text') return field.value.trim() !== '';
  return field.value !== '';
};

/** Date fields are filled by the server at signing, so the walk skips them. */
export const walksTo = (field: { kind: FieldKind; required: boolean }): boolean =>
  field.required && field.kind !== 'date';

export const defaultLabel = (kind: FieldKind, countOfKind: number): string =>
  `${KIND_WORD[kind]} ${countOfKind}`;

export const readingOrder = <T extends { page: number; y: number; x: number }>(
  fields: readonly T[],
): T[] =>
  [...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part !== '')
    .map((part) => [...part][0]?.toUpperCase() ?? '')
    .join('');
