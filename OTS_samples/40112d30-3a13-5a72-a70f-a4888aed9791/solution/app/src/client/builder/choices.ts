import type { ChoiceOption } from '../../shared/types.ts';

// Options, rows and columns are typed one per line, with value and label the same.

export const choiceLines = (choices: ChoiceOption[] | undefined): string => (choices ?? []).map((choice) => choice.label).join('\n');

/** A line that matches an existing label keeps that choice's value, so renaming other lines never changes it. */
export function choicesFrom(text: string, existing: ChoiceOption[] = []): ChoiceOption[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((label) => ({ value: existing.find((choice) => choice.label === label)?.value ?? label, label }));
}
