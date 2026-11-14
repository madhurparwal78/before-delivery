import { createHash } from "node:crypto";
import { allQuestions } from "../../shared/changes.js";
import { formatDate, isRealDate } from "../../shared/formats.js";
import { M } from "../../shared/messages.js";
import type {
  AnswerValue,
  Answers,
  CalcValue,
  Definition,
  EvalPage,
  EvalQuestion,
  Evaluation,
  FileAnswer,
  ItemState,
  Option,
  Question,
  RespondentField,
  ShowRule,
} from "../../shared/types.js";
import { config } from "../config.js";
import { CalcError, Decimal } from "./decimal.js";
import { INSERTION_PATTERN } from "./definition.js";
import { BLANK, evaluate, text, truth, type Scope, type Value } from "./evaluate.js";
import { FormulaRefusal, parseFormula, type Node } from "./formula.js";

const parsed = new Map<string, Node | null>();

function parseCached(source: string): Node | null {
  let node = parsed.get(source);
  if (node === undefined) {
    try {
      node = parseFormula(source);
    } catch (error) {
      if (!(error instanceof FormulaRefusal)) throw error;
      node = null;
    }
    if (parsed.size > 5000) parsed.clear();
    parsed.set(source, node);
  }
  return node;
}

export type CalcResult = { ok: true; value: Value } | { ok: false; reason: string };

interface ItemStatus {
  state: ItemState;
  skipped_by: string | null;
}

/** The outcome of walking a form with a set of answers. */
export interface Walk {
  def: Definition;
  answers: Answers;
  pages: Map<string, ItemStatus>;
  questions: Map<string, ItemStatus>;
  calc: Map<string, CalcResult>;
  litPages: string[];
  scope: Scope;
}

export function isAnswered(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if ("name" in value && "size" in value && typeof value.size === "number") return true;
  return Object.keys(value).length > 0;
}

function asGrid(value: AnswerValue | undefined): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
}

function rawValue(question: Question, raw: AnswerValue | undefined, calc: Map<string, CalcResult>): Value {
  if (question.type === "calculated") {
    const result = calc.get(question.key);
    return result?.ok ? result.value : BLANK;
  }
  if (!isAnswered(raw)) return BLANK;
  switch (question.type) {
    case "short_text":
    case "long_text":
    case "choice":
    case "dropdown":
      return text(raw as string);
    case "number":
    case "scale": {
      const d = Decimal.parse(raw as string);
      return d ? { t: "num", v: d } : BLANK;
    }
    case "date":
      return isRealDate((raw as string).trim()) ? { t: "date", v: (raw as string).trim() } : BLANK;
    case "checkbox": {
      const ticked = raw as string[];
      return { t: "list", v: (question.options ?? []).map((o) => o.value).filter((v) => ticked.includes(v)) };
    }
    default:
      return { t: "opaque" };
  }
}

function ruleMet(rule: ShowRule, scope: Scope): boolean {
  const node = parseCached(rule.when);
  if (!node) return false;
  try {
    return truth(evaluate(node, scope));
  } catch (error) {
    if (error instanceof CalcError) return false;
    throw error;
  }
}

/** Walks the form once, in order, deciding every page, question and calculated value. */
export function walkForm(def: Definition, answers: Answers, today: string): Walk {
  const pages = new Map<string, ItemStatus>();
  const questions = new Map<string, ItemStatus>();
  const calc = new Map<string, CalcResult>();
  const effective = new Map<string, Value>();
  const litQuestions = new Map<string, Question>();
  const scope: Scope = {
    today,
    ref(key, row) {
      if (row === null) return effective.get(key) ?? BLANK;
      if (!litQuestions.has(key)) return BLANK;
      return text(asGrid(answers[key])[row] ?? "");
    },
  };
  let jump: { name: string; to: string } | null = null;
  def.pages.forEach((page, p) => {
    let status: ItemStatus;
    if (jump && jump.to !== page.key) status = { state: "skipped", skipped_by: jump.name };
    else {
      jump = null;
      status =
        page.show_rule && !ruleMet(page.show_rule, scope)
          ? { state: "skipped", skipped_by: page.show_rule.name }
          : { state: "lit", skipped_by: null };
    }
    pages.set(page.key, status);
    for (const question of page.questions) {
      if (status.state === "skipped") {
        questions.set(question.key, status);
        continue;
      }
      if (question.show_rule && !ruleMet(question.show_rule, scope)) {
        questions.set(question.key, { state: "skipped", skipped_by: question.show_rule.name });
        continue;
      }
      questions.set(question.key, { state: "lit", skipped_by: null });
      litQuestions.set(question.key, question);
      if (question.type === "calculated") calc.set(question.key, calculate(question, scope));
      effective.set(question.key, rawValue(question, answers[question.key], calc));
    }
    if (status.state === "lit") {
      for (const candidate of page.jumps ?? []) {
        const to = def.pages.findIndex((x) => x.key === candidate.to);
        if (to > p && ruleMet({ name: candidate.name, when: candidate.when }, scope)) {
          jump = { name: candidate.name, to: candidate.to };
          break;
        }
      }
    }
  });
  const litPages = def.pages.filter((p) => pages.get(p.key)?.state === "lit").map((p) => p.key);
  return { def, answers, pages, questions, calc, litPages, scope };
}

function calculate(question: Question, scope: Scope): CalcResult {
  const node = parseCached(question.formula ?? "");
  if (!node) return { ok: true, value: BLANK };
  try {
    return { ok: true, value: evaluate(node, scope) };
  } catch (error) {
    if (error instanceof CalcError) return { ok: false, reason: error.reason };
    throw error;
  }
}

export function isLit(walk: Walk, key: string): boolean {
  return walk.questions.get(key)?.state === "lit";
}

/* ---------- Display ---------- */

function valueData(value: Value): string | null {
  switch (value.t) {
    case "num":
      return value.v.toText();
    case "text":
    case "date":
      return value.v;
    case "bool":
      return value.v ? "true" : "false";
    default:
      return null;
  }
}

/** A calculated field's unrounded value and shown text. */
export function calcValue(question: Question, walk: Walk): CalcValue {
  const result = walk.calc.get(question.key);
  if (!result) return { value: null, text: M.notCalculated };
  if (!result.ok) return { value: null, text: `Cannot calculate: ${result.reason}` };
  const value = result.value;
  switch (value.t) {
    case "num": {
      const shown = question.places === undefined ? value.v.toText() : value.v.toFixed(question.places);
      return { value: value.v.toText(), text: `${question.prefix ?? ""}${shown}${question.suffix ?? ""}` };
    }
    case "date":
      return { value: value.v, text: formatDate(value.v) };
    case "text":
      return { value: value.v, text: value.v };
    case "bool":
      return { value: valueData(value), text: value.v ? "true" : "false" };
    default:
      return { value: null, text: M.notCalculated };
  }
}

function optionLabel(options: Option[] | undefined, value: string): string {
  return options?.find((o) => o.value === value)?.label ?? value;
}

/** The display text of an effective answer, or null when it is blank. */
export function displayText(question: Question, walk: Walk, row: string | null = null): string | null {
  const raw = walk.answers[question.key];
  if (question.type === "calculated") {
    const result = walk.calc.get(question.key);
    if (!result || (result.ok && result.value.t === "blank")) return null;
    return calcValue(question, walk).text;
  }
  if (row !== null) {
    const column = asGrid(raw)[row];
    return column ? optionLabel(question.columns, column) : null;
  }
  if (!isAnswered(raw)) return null;
  switch (question.type) {
    case "number":
    case "scale":
      return Decimal.parse(raw as string)?.toText() ?? (raw as string);
    case "choice":
    case "dropdown":
      return optionLabel(question.options, raw as string);
    case "checkbox":
      return (question.options ?? []).filter((o) => (raw as string[]).includes(o.value)).map((o) => o.label).join(", ");
    case "date":
      return isRealDate((raw as string).trim()) ? formatDate((raw as string).trim()) : (raw as string);
    case "ranking":
      return (raw as string[]).map((v) => optionLabel(question.options, v)).join(" > ");
    case "file":
      return (raw as FileAnswer).name;
    case "grid": {
      const grid = asGrid(raw);
      return (question.rows ?? [])
        .filter((r) => grid[r.value])
        .map((r) => `${r.label}: ${optionLabel(question.columns, grid[r.value])}`)
        .join("; ");
    }
    default:
      return raw as string;
  }
}

/** Fills `{{key}}` insertions with effective answers as plain text. */
export function fill(source: string, walk: Walk): string {
  return source.replace(INSERTION_PATTERN, (whole, key: string, row: string | undefined) => {
    const question = allQuestions(walk.def).find((q) => q.key === key);
    if (!question) return whole;
    if (!isLit(walk, key)) return M.notAnswered;
    return displayText(question, walk, row ?? null) ?? M.notAnswered;
  });
}

function shuffled(question: Question): Option[] {
  const options = question.options ?? [];
  if (!question.shuffle || (question.type !== "choice" && question.type !== "checkbox")) return options;
  const digest = (o: Option): string =>
    createHash("sha256").update(`${config.shuffleSeed}:${question.key}:${o.value}`).digest("hex");
  return [...options].map((o) => ({ o, d: digest(o) })).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).map((x) => x.o);
}

function respondentField(question: Question): RespondentField {
  const field: RespondentField = { type: question.type, required: question.required === true };
  if (question.options) field.options = shuffled(question);
  if (question.rows) field.rows = question.rows;
  if (question.columns) field.columns = question.columns;
  if (question.min !== undefined) field.min = String(question.min);
  if (question.max !== undefined) field.max = String(question.max);
  if (question.min_label) field.min_label = question.min_label;
  if (question.max_label) field.max_label = question.max_label;
  if (question.decimals !== undefined) field.decimals = question.decimals;
  if (question.type === "file") {
    field.accept = question.accept ?? ["pdf", "png", "jpeg"];
    field.max_bytes = question.max_bytes ?? config.uploadMaxBytes;
  }
  return field;
}

export type Audience = "respondent" | "builder";

function countChanged(before: Walk, after: Walk): { hidden: number; restored: number } {
  let hidden = 0;
  let restored = 0;
  for (const question of allQuestions(after.def)) {
    if (question.type === "calculated") continue;
    const was = isLit(before, question.key);
    const now = isLit(after, question.key);
    if (was && !now && isAnswered(before.answers[question.key])) hidden++;
    if (!was && now && isAnswered(after.answers[question.key])) restored++;
  }
  return { hidden, restored };
}

export interface EvaluationOptions {
  seq: number;
  audience: Audience;
  previous?: Walk;
  announce?: (evaluation: Evaluation) => string;
}

/** Builds the evaluation object every caller receives. */
export function buildEvaluation(walk: Walk, options: EvaluationOptions): Evaluation {
  const respondent = options.audience === "respondent";
  const pages: EvalPage[] = walk.def.pages.map((page) => {
    const status = walk.pages.get(page.key) as ItemStatus;
    const questions: EvalQuestion[] = page.questions
      .filter((q) => !(respondent && q.type === "calculated" && q.hidden))
      .map((q) => {
        const qs = walk.questions.get(q.key) as ItemStatus;
        const item: EvalQuestion = {
          key: q.key,
          state: qs.state,
          skipped_by: qs.skipped_by,
          label: fill(q.label, walk),
          help: q.help ? fill(q.help, walk) : null,
        };
        if (respondent) item.field = respondentField(q);
        return item;
      });
    return { key: page.key, title: fill(page.title, walk), state: status.state, skipped_by: status.skipped_by, questions };
  });
  const values: Record<string, CalcValue> = {};
  for (const q of allQuestions(walk.def))
    if (q.type === "calculated" && !(respondent && q.hidden)) values[q.key] = calcValue(q, walk);
  const changed = options.previous ? countChanged(options.previous, walk) : { hidden: 0, restored: 0 };
  const evaluation: Evaluation = {
    seq: options.seq,
    pages,
    shown_pages: walk.litPages.length,
    values,
    hidden_now: changed.hidden,
    restored: changed.restored,
    announce: "",
  };
  evaluation.announce = options.announce ? options.announce(evaluation) : "";
  return evaluation;
}

/** The polite sentences a commit produces: the path notice, then changed calculated values. */
export function commitAnnouncement(before: Evaluation, after: Evaluation, currentPage: string): string {
  const parts: string[] = [];
  if (after.hidden_now > 0) parts.push(M.hiddenNotice(after.hidden_now));
  if (after.restored > 0) parts.push(M.restoredNotice(after.restored));
  const page = after.pages.find((p) => p.key === currentPage);
  for (const q of page?.questions ?? []) {
    const value = after.values[q.key];
    if (!value || q.state !== "lit") continue;
    const old = before.values[q.key];
    const wasShown = before.pages.find((p) => p.key === currentPage)?.questions.find((x) => x.key === q.key)?.state === "lit";
    if (!wasShown || old?.text !== value.text) parts.push(M.valueLine(q.label, value.text));
  }
  return parts.join(" ");
}

export function pageAnnouncement(walk: Walk, pageKey: string, evaluation: Evaluation): string {
  const n = walk.litPages.indexOf(pageKey) + 1;
  const title = evaluation.pages.find((p) => p.key === pageKey)?.title ?? "";
  return M.pageAnnounce(n, walk.litPages.length, title);
}
