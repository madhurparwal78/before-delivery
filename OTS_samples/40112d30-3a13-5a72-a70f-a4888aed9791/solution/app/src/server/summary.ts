import type { ChoiceOption, FormDefinition, Question, Summary, SummaryQuestion, SummaryRow } from '../shared/types.ts';
import { pool } from './db.ts';
import { averageText, compareDecimalText, numberText, percentText, type Resolved } from './engine/index.ts';
import { loadEdition, loadForm } from './forms.ts';
import { loadSubmitted, type Submitted } from './submitted.ts';

// The summary counts only submitted, undeleted responses across all editions; questions are matched by key and take
// the newest edition's raw label, and options removed later stay as rows (brief: Summary).

const ZERO_MEAN = '0.00';

function effective(res: Resolved, key: string): { value: unknown; calc: Resolved['questions'][number]['calc'] } {
  const found = res.questions.find((q) => q.key === key);
  return { value: found?.state === 'lit' ? found.value : null, calc: found?.state === 'lit' ? (found.calc ?? null) : null };
}

function optionRows(options: ChoiceOption[][], counts: Map<string, number>, answered: number): SummaryRow[] {
  const seen = new Map<string, string>();
  for (const list of options) for (const option of list) if (!seen.has(option.value)) seen.set(option.value, option.label);
  return [...seen].map(([value, label]) => {
    const count = counts.get(value) ?? 0;
    return { value, label, count: String(count), percent: percentText(count, answered) };
  });
}

function tally(values: (string | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** Every definition that carried this key, newest edition first. */
function carriers(defs: FormDefinition[], key: string): Question[] {
  return defs.flatMap((def) => def.pages.flatMap((p) => p.questions).filter((q) => q.key === key));
}

function summarizeQuestion(question: Question, older: Question[], rows: Submitted[]): SummaryQuestion {
  const key = question.key;
  const answers = rows.map((row) => effective(row.res, key));
  const filled = answers.filter((a) => a.value !== null && a.value !== undefined && !(Array.isArray(a.value) && a.value.length === 0));
  const base: SummaryQuestion = {
    key, label: question.label, type: question.type, answered: String(filled.length),
    rows: [], mean: null, lowest: null, highest: null, grid: [], ranking: [],
  };
  const all = [question, ...older];
  switch (question.type) {
    case 'choice':
    case 'dropdown': {
      const counts = tally(filled.map((a) => (typeof a.value === 'string' ? a.value : undefined)));
      return { ...base, rows: optionRows(all.map((q) => q.options ?? []), counts, filled.length) };
    }
    case 'checkbox': {
      const counts = tally(filled.flatMap((a) => (Array.isArray(a.value) ? a.value : [])));
      return { ...base, rows: optionRows(all.map((q) => q.options ?? []), counts, filled.length) };
    }
    case 'scale': {
      const min = Number(question.min ?? 1);
      const max = Number(question.max ?? 5);
      const scale: ChoiceOption[] = [];
      for (let n = min; n <= max; n += 1) scale.push({ value: String(n), label: String(n) });
      const values = filled.map((a) => String(a.value));
      return { ...base, ...figures(values), rows: optionRows([scale], tally(values), filled.length) };
    }
    case 'number':
      return { ...base, ...figures(filled.map((a) => String(a.value))) };
    case 'calculated':
      return { ...base, ...figures(filled.filter((a) => a.calc?.numeric && a.calc.value !== null).map((a) => String(a.calc?.value))) };
    case 'grid': {
      const grid = (question.rows ?? []).map((row) => {
        const picks = filled.map((a) => (a.value as Record<string, string>)[row.value]);
        const answered = picks.filter((p) => p !== undefined).length;
        return { row: row.value, label: row.label, rows: optionRows(all.map((q) => q.columns ?? []), tally(picks), answered) };
      });
      return { ...base, grid };
    }
    case 'ranking': {
      const orders = filled.map((a) => a.value as string[]);
      const options = optionRows(all.map((q) => q.options ?? []), new Map(), 0);
      const ranking = options.map((option, index) => ({
        index, value: option.value, label: option.label,
        mean_position: orders.length ? averageText(orders.map((order) => String(order.indexOf(option.value) + 1)), 2) : ZERO_MEAN,
      }));
      ranking.sort((a, b) => Number(a.mean_position) - Number(b.mean_position) || a.index - b.index);
      return { ...base, ranking: ranking.map(({ value, label, mean_position }) => ({ value, label, mean_position })) };
    }
    default:
      return base;
  }
}

function figures(values: string[]): Pick<SummaryQuestion, 'mean' | 'lowest' | 'highest'> {
  if (values.length === 0) return { mean: null, lowest: null, highest: null };
  const sorted = [...values].sort(compareDecimalText);
  return { mean: averageText(values, 2), lowest: numberText(sorted[0] ?? '0'), highest: numberText(sorted[sorted.length - 1] ?? '0') };
}

export async function summarize(formId: string): Promise<Summary> {
  const form = await loadForm(pool, formId);
  const rows = await loadSubmitted(pool, formId);
  if (!form) return { count: '0', questions: [] };
  const editions = [...new Set(rows.map((r) => r.edition).concat(form.live_edition ?? []))].sort((a, b) => b - a);
  const defs = await Promise.all(editions.map((n) => loadEdition(pool, formId, n)));
  const keys: string[] = [];
  for (const def of defs) for (const page of def.pages) for (const q of page.questions) if (!keys.includes(q.key)) keys.push(q.key);
  const questions = keys.map((key) => {
    const [newest, ...older] = carriers(defs, key);
    return newest ? summarizeQuestion(newest, older, rows) : null;
  }).filter((q): q is SummaryQuestion => q !== null);
  return { count: String(rows.length), questions };
}
