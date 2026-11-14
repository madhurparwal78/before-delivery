import { findReferenced } from './outline.ts';
import type { Outline } from './outline.ts';

const INSERTION = /\{\{([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?\}\}/g;

/** The first refusal for the `{{key}}` insertions in a label, help text, page title or check message. */
export function insertionProblem(text: string, limit: number, outline: Outline): string | null {
  for (const match of text.matchAll(INSERTION)) {
    const [written, key = '', row = null] = match;
    const target = findReferenced(outline, key, row);
    if (target === undefined) return `${written} is not a question in this form.`;
    if (target.position >= limit) return `${written} comes later in the form, so it cannot be inserted here.`;
    const { type } = target.question;
    if (type === 'ranking' || type === 'file' || (type === 'grid' && row === null)) {
      return `${written} cannot be inserted.`;
    }
  }
  return null;
}

/** Replaces every `{{key}}` and `{{key.row}}` with what `display` returns for it. */
export function fillInsertions(text: string, display: (key: string, row: string | null) => string): string {
  return text.replace(INSERTION, (_written: string, key: string, row: string | undefined) => display(key, row ?? null));
}
