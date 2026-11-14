import type { Change, FormDefinition, Page, Question } from './types.ts';

// The one structural edit of a draft. The server applies each change with it and every open builder replays the
// same change in the same order, so all of them hold the same draft (brief: Live editing).

/** Where a `set` change lands: the question or page with that key, else the form itself. */
export const FORM_KEY = 'form';

function findQuestion(def: FormDefinition, key: string): { page: Page; question: Question; index: number } | null {
  for (const page of def.pages) {
    const index = page.questions.findIndex((q) => q.key === key);
    const question = page.questions[index];
    if (question) return { page, question, index };
  }
  return null;
}

const without = <T extends object>(target: T, field: string): void => { delete (target as Record<string, unknown>)[field]; };

function setField(target: object, field: string, value: unknown): void {
  if (value === null || value === undefined) without(target, field);
  else (target as Record<string, unknown>)[field] = value;
}

/** Returns the edited copy, or null when the change names a question or page that no longer exists. */
export function applyChange(def: FormDefinition, change: Change): FormDefinition | null {
  const next = structuredClone(def);
  switch (change.op) {
    case 'set': {
      const found = findQuestion(next, change.key);
      if (found) {
        setField(found.question, change.field, change.value);
        return next;
      }
      const page = next.pages.find((p) => p.key === change.key);
      if (page) {
        setField(page, change.field, change.value);
        return next;
      }
      if (change.key !== FORM_KEY) return null;
      setField(next, change.field, change.value);
      return next;
    }
    case 'add_question': {
      const page = next.pages.find((p) => p.key === change.page);
      if (!page) return null;
      page.questions.push(change.question);
      return next;
    }
    case 'remove_question': {
      const found = findQuestion(next, change.key);
      if (!found) return null;
      found.page.questions.splice(found.index, 1);
      next.checks = next.checks.filter((check) => check.target !== change.key);
      return next;
    }
    case 'move_question': {
      const found = findQuestion(next, change.key);
      if (!found) return null;
      found.page.questions.splice(found.index, 1);
      const position = Math.min(Math.max(Math.trunc(change.position), 1), found.page.questions.length + 1);
      found.page.questions.splice(position - 1, 0, found.question);
      return next;
    }
    case 'add_page': {
      const position = Math.min(Math.max(Math.trunc(change.position), 1), next.pages.length + 1);
      next.pages.splice(position - 1, 0, change.page);
      return next;
    }
    case 'remove_page': {
      const index = next.pages.findIndex((p) => p.key === change.key);
      if (index < 0) return null;
      next.pages.splice(index, 1);
      next.checks = next.checks.filter((check) => check.page !== change.key);
      return next;
    }
  }
}
