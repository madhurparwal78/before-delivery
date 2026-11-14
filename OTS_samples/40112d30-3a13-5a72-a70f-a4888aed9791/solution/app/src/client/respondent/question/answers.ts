import type { AnswerValue, FileAnswer } from '../../../shared/types.ts';

export const asText = (value: AnswerValue | undefined): string => (typeof value === 'string' ? value : '');

export const asList = (value: AnswerValue | undefined): string[] => (Array.isArray(value) ? value : []);

export function asRecord(value: AnswerValue | undefined): Record<string, string> {
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function asFile(value: AnswerValue | undefined): FileAnswer | null {
  if (typeof value !== 'object' || Array.isArray(value) || !('size' in value) || typeof value.size !== 'number') return null;
  return { name: String(value.name), size: value.size, type: String(value.type) };
}
