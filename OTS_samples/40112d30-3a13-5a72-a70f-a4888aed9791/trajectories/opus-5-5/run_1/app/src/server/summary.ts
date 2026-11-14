import type { AnswerValue, Option, Question, Summary, SummaryQuestion, SummaryRow } from "../shared/types.js";
import { Decimal } from "./engine/decimal.js";
import { isAnswered } from "./engine/walk.js";
import { loadForm } from "./forms.js";
import { loadHistory, type SubmittedRow } from "./history.js";
import { keys, publish } from "./valkey.js";

function ratio(numerator: Decimal, denominator: number, places: number): string {
  if (denominator === 0) return Decimal.ZERO.toFixed(places);
  return numerator.div(Decimal.fromInt(denominator)).toFixed(places);
}

function rowsFor(options: Option[], answered: number, count: (value: string) => number): SummaryRow[] {
  return options.map((o) => {
    const n = count(o.value);
    return { value: o.value, label: o.label, count: String(n), percent: ratio(Decimal.fromInt(n * 100), answered, 1) };
  });
}

function scaleOptions(question: Question): Option[] {
  const options: Option[] = [];
  for (let n = Number(question.min); n <= Number(question.max); n++) options.push({ value: String(n), label: String(n) });
  return options;
}

function numericValue(question: Question, response: SubmittedRow): Decimal | null {
  if (question.type === "calculated") {
    const value = response.calc_values[question.key]?.value;
    return value ? Decimal.parse(value) : null;
  }
  const answer = response.answers[question.key];
  return typeof answer === "string" ? Decimal.parse(answer) : null;
}

function isNumericCalc(question: Question, responses: SubmittedRow[]): boolean {
  return question.type === "calculated" && responses.some((r) => numericValue(question, r) !== null);
}

function summarise(question: Question, responses: SubmittedRow[]): SummaryQuestion {
  const answers = responses.map((r) => r.answers[question.key]).filter((a): a is AnswerValue => isAnswered(a));
  const answered =
    question.type === "calculated"
      ? responses.filter((r) => (r.calc_values[question.key]?.value ?? null) !== null).length
      : answers.length;
  const item: SummaryQuestion = { key: question.key, label: question.label, type: question.type, answered: String(answered) };
  switch (question.type) {
    case "choice":
    case "dropdown":
      item.rows = rowsFor(question.options ?? [], answered, (v) => answers.filter((a) => a === v).length);
      break;
    case "checkbox":
      item.rows = rowsFor(question.options ?? [], answered, (v) => answers.filter((a) => Array.isArray(a) && a.includes(v)).length);
      break;
    case "scale":
      item.rows = rowsFor(scaleOptions(question), answered, (v) => answers.filter((a) => typeof a === "string" && Number(a) === Number(v)).length);
      break;
    case "grid":
      item.grid = (question.rows ?? []).map((row) => {
        const picks = answers.map((a) => (a as Record<string, string>)[row.value]).filter((v): v is string => typeof v === "string");
        return { row: row.value, label: row.label, rows: rowsFor(question.columns ?? [], picks.length, (v) => picks.filter((p) => p === v).length) };
      });
      break;
    case "ranking": {
      const options = question.options ?? [];
      item.ranking = options
        .map((o, index) => {
          const positions = answers.map((a) => (a as string[]).indexOf(o.value)).filter((p) => p >= 0);
          const total = positions.reduce((s, p) => s + p + 1, 0);
          return { index, value: o.value, label: o.label, mean: positions.length ? Decimal.fromInt(total).div(Decimal.fromInt(positions.length)) : null };
        })
        .sort((a, b) => (a.mean && b.mean ? a.mean.cmp(b.mean) || a.index - b.index : a.mean ? -1 : b.mean ? 1 : a.index - b.index))
        .map((r) => ({ value: r.value, label: r.label, mean_position: r.mean ? r.mean.toFixed(2) : null }));
      break;
    }
    default:
      break;
  }
  if (question.type === "number" || question.type === "scale" || isNumericCalc(question, responses)) {
    const values = responses.map((r) => numericValue(question, r)).filter((v): v is Decimal => v !== null);
    const sum = values.reduce((s, v) => s.add(v), Decimal.ZERO);
    item.mean = values.length ? ratio(sum, values.length, 2) : null;
    item.lowest = values.length ? values.reduce((m, v) => (v.cmp(m) < 0 ? v : m)).toText() : null;
    item.highest = values.length ? values.reduce((m, v) => (v.cmp(m) > 0 ? v : m)).toText() : null;
  }
  return item;
}

/** Counts only submitted, undeleted responses across all editions. */
export async function computeSummary(formId: string): Promise<Summary> {
  const form = await loadForm(formId);
  const history = await loadHistory(formId, form?.live_edition ?? null);
  return {
    count: String(history.responses.length),
    questions: history.questions.map((q) => summarise(q, history.responses)),
  };
}

export async function pushSummary(formId: string): Promise<void> {
  await publish(keys.summaryChannel(formId), { type: "summary", summary: await computeSummary(formId) });
}
