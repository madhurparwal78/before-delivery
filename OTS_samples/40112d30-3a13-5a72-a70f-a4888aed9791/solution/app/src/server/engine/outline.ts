import type { FormDefinition, Page, Question } from '../../shared/types.ts';

interface OutlineQuestion {
  question: Question;
  page: Page;
  /** Place of the question in the whole form, counting from 0. */
  position: number;
}

/** The questions of a form in form order, with the positions that decide what may refer to what. */
export interface Outline {
  questions: OutlineQuestion[];
  byKey: Map<string, OutlineQuestion>;
  /** Position of each page's first question. */
  pageStart: Map<string, number>;
  /** Position just past each page's last question. */
  pageEnd: Map<string, number>;
}

export function outlineOf(definition: FormDefinition): Outline {
  const questions: OutlineQuestion[] = [];
  const pageStart = new Map<string, number>();
  const pageEnd = new Map<string, number>();
  for (const page of definition.pages) {
    pageStart.set(page.key, questions.length);
    for (const question of page.questions) questions.push({ question, page, position: questions.length });
    pageEnd.set(page.key, questions.length);
  }
  const byKey = new Map<string, OutlineQuestion>();
  for (const entry of questions) if (!byKey.has(entry.question.key)) byKey.set(entry.question.key, entry);
  return { questions, byKey, pageStart, pageEnd };
}

/** The question a reference `{key}` or `{key.row}` names; undefined when the key or the grid row does not exist. */
export function findReferenced(outline: Outline, key: string, row: string | null): OutlineQuestion | undefined {
  const target = outline.byKey.get(key);
  if (target === undefined || row === null) return target;
  const rowExists = target.question.type === 'grid' && (target.question.rows ?? []).some((candidate) => candidate.value === row);
  return rowExists ? target : undefined;
}
