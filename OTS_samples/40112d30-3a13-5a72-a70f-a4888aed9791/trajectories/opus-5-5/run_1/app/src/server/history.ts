import type { Answers, Definition, Option, Question } from "../shared/types.js";
import { query } from "./db.js";
import { editionDefinition } from "./forms.js";

export interface SubmittedRow {
  id: string;
  edition: number;
  answers: Answers;
  calc_values: Record<string, { value: string | null; text: string }>;
  submitted_at: Date;
}

export interface History {
  /** Editions by number. */
  editions: Map<number, Definition>;
  /** The newest edition's questions in form order, then keys found only in older editions, first seen first. */
  questions: Question[];
  responses: SubmittedRow[];
}

/** Submitted responses (oldest first) with every edition they were submitted against. */
export async function loadHistory(formId: string, liveEdition: number | null): Promise<History> {
  const responses = await query<SubmittedRow>(
    "SELECT id, edition, answers, calc_values, submitted_at FROM responses WHERE form_id = $1 AND status = 'submitted' ORDER BY submitted_at, id",
    [formId],
  );
  const numbers = new Set<number>(responses.map((r) => r.edition));
  if (liveEdition !== null) numbers.add(liveEdition);
  const ordered = [...numbers].sort((a, b) => a - b);
  const editions = new Map<number, Definition>();
  for (const n of ordered) editions.set(n, await editionDefinition(formId, n));
  const newestFirst = [...ordered].reverse();
  const questions: Question[] = [];
  const seen = new Set<string>();
  const add = (q: Question): void => {
    if (seen.has(q.key)) return;
    seen.add(q.key);
    questions.push(merged(q.key, newestFirst.map((n) => editions.get(n) as Definition)));
  };
  if (newestFirst.length) (editions.get(newestFirst[0]) as Definition).pages.forEach((p) => p.questions.forEach(add));
  for (const n of ordered) (editions.get(n) as Definition).pages.forEach((p) => p.questions.forEach(add));
  return { editions, questions, responses };
}

function mergeOptions(lists: (Option[] | undefined)[]): Option[] | undefined {
  const merged: Option[] = [];
  for (const list of lists) for (const option of list ?? []) if (!merged.some((o) => o.value === option.value)) merged.push(option);
  return merged.length ? merged : undefined;
}

/** The newest version of a question, keeping options and rows removed in later editions. */
function merged(key: string, newestFirst: Definition[]): Question {
  const versions = newestFirst.flatMap((d) => d.pages.flatMap((p) => p.questions.filter((q) => q.key === key)));
  const newest = versions[0];
  const same = versions.filter((v) => v.type === newest.type);
  return {
    ...newest,
    options: mergeOptions(same.map((v) => v.options)),
    rows: mergeOptions(same.map((v) => v.rows)),
    columns: mergeOptions(same.map((v) => v.columns)),
  };
}
