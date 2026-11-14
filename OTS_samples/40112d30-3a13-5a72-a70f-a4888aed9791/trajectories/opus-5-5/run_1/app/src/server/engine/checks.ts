import { findQuestion } from "../../shared/changes.js";
import { formatDate, isRealDate } from "../../shared/formats.js";
import type { AnswerValue, Definition, ErrorItem, Question } from "../../shared/types.js";
import { CalcError, Decimal } from "./decimal.js";
import { evaluate, truth } from "./evaluate.js";
import { parseFormula, visitRefs, FormulaRefusal } from "./formula.js";
import { fill, isAnswered, isLit, type Walk } from "./walk.js";

/**
 * The published email pattern `^[^@\s]+@[^@\s]+\.[^@\s]+$`, checked without backtracking:
 * one `@`, no white space, and a dot in the domain with characters on both sides.
 */
export function isEmail(text: string): boolean {
  if (/\s/.test(text)) return false;
  const parts = text.split("@");
  return parts.length === 2 && parts[0] !== "" && parts[1].slice(1, -1).includes(".");
}

const PATTERNS = {
  email: { test: isEmail, message: "enter an email address like name@example.com." },
  phone: { test: (t: string) => /^\+?[0-9 ]{7,20}$/.test(t), message: "enter digits, spaces and an optional leading +." },
  digits: { test: (t: string) => /^[0-9]+$/.test(t), message: "use digits only." },
  letters: { test: (t: string) => /^[A-Za-z]+$/.test(t), message: "use letters only." },
} as const;

const NUMBER_FORMAT = /^-?[0-9]+(\.[0-9]+)?$/;
const MAX_TEXT = 10000;

function requiredMessage(question: Question): string {
  switch (question.type) {
    case "choice":
    case "dropdown":
    case "scale":
      return "choose an option.";
    case "checkbox":
      return "tick at least one option.";
    case "grid":
      return "choose an option in every row.";
    case "ranking":
      return "move at least one option to set your order.";
    case "date":
      return "enter a date.";
    case "file":
      return "attach a file.";
    default:
      return "answer this question.";
  }
}

function rangeMessage(min: string | null, max: string | null, kind: "number" | "date"): string {
  const noun = kind === "number" ? "a number" : "a date";
  if (min !== null && max !== null) return `enter ${noun} from ${min} to ${max}.`;
  if (min !== null) return kind === "number" ? `enter a number from ${min} or more.` : `enter a date from ${min} or later.`;
  return `enter ${noun} up to ${max}.`;
}

/** The first failing field check for one question, without its label. */
function fieldProblem(question: Question, raw: AnswerValue | undefined): string | null {
  if (question.type === "calculated") return null;
  const grid = question.type === "grid" && raw && typeof raw === "object" ? (raw as Record<string, string>) : null;
  if (!isAnswered(raw)) return question.required ? requiredMessage(question) : null;
  if (grid && question.required && (question.rows ?? []).some((r) => !grid[r.value])) return requiredMessage(question);
  switch (question.type) {
    case "number": {
      const answer = (raw as string).trim();
      if (!NUMBER_FORMAT.test(answer)) return "enter a number.";
      const places = answer.includes(".") ? answer.length - answer.indexOf(".") - 1 : 0;
      if (question.decimals !== undefined && places > question.decimals)
        return question.decimals === 0 ? "enter a whole number." : `use at most ${question.decimals} decimal places.`;
      const value = Decimal.parse(answer) as Decimal;
      const min = question.min === undefined ? null : (Decimal.parse(String(question.min)) as Decimal);
      const max = question.max === undefined ? null : (Decimal.parse(String(question.max)) as Decimal);
      if ((min && value.cmp(min) < 0) || (max && value.cmp(max) > 0))
        return rangeMessage(min ? min.toText() : null, max ? max.toText() : null, "number");
      return null;
    }
    case "date": {
      const answer = (raw as string).trim();
      if (!isRealDate(answer)) return "enter a real date as YYYY-MM-DD.";
      const min = typeof question.min === "string" ? question.min : null;
      const max = typeof question.max === "string" ? question.max : null;
      if ((min && answer < min) || (max && answer > max))
        return rangeMessage(min ? formatDate(min) : null, max ? formatDate(max) : null, "date");
      return null;
    }
    case "short_text":
    case "long_text": {
      const length = Array.from((raw as string).trim()).length;
      if (question.min_length !== undefined && length < question.min_length) return `use at least ${question.min_length} characters.`;
      if (question.max_length !== undefined && length > question.max_length) return `use at most ${question.max_length} characters.`;
      if (question.pattern) {
        const pattern = PATTERNS[question.pattern];
        if (!pattern.test((raw as string).trim())) return pattern.message;
      }
      return null;
    }
    case "checkbox": {
      const count = (raw as string[]).length;
      const min = question.min_selected;
      const max = question.max_selected;
      if ((min !== undefined && count < min) || (max !== undefined && count > max)) {
        if (min !== undefined && max !== undefined) return `tick from ${min} to ${max} options.`;
        if (min !== undefined) return `tick at least ${min} options.`;
        return `tick at most ${max} options.`;
      }
      return null;
    }
    default:
      return null;
  }
}

function baseInputs(def: Definition, source: string, seen = new Set<string>()): Set<string> {
  let node;
  try {
    node = parseFormula(source);
  } catch (error) {
    if (error instanceof FormulaRefusal) return seen;
    throw error;
  }
  visitRefs(node, (ref) => {
    if (seen.has(ref.key)) return;
    seen.add(ref.key);
    const found = findQuestion(def, ref.key);
    if (found?.question.type === "calculated") baseInputs(def, found.question.formula ?? "", seen);
  });
  return seen;
}

/** Runs the published checks for one shown page, in page order. */
export function pageErrors(walk: Walk, pageKey: string): ErrorItem[] {
  const def = walk.def;
  const page = def.pages.find((p) => p.key === pageKey);
  if (!page || walk.pages.get(pageKey)?.state !== "lit") return [];
  const errors = new Map<string, string>();
  for (const question of page.questions) {
    if (!isLit(walk, question.key)) continue;
    const problem = fieldProblem(question, walk.answers[question.key]);
    if (problem) errors.set(question.key, `${fill(question.label, walk)}: ${problem}`);
  }
  for (const check of def.checks ?? []) {
    if (check.page !== pageKey || errors.has(check.target) || !isLit(walk, check.target)) continue;
    const inputs = [...baseInputs(def, check.fail_when)];
    const ready = inputs.every((key) => {
      const found = findQuestion(def, key);
      if (!found || !isLit(walk, key)) return false;
      if (found.question.type === "calculated") return true;
      return isAnswered(walk.answers[key]) && fieldProblem(found.question, walk.answers[key]) === null;
    });
    if (!ready) continue;
    let failed = false;
    try {
      failed = truth(evaluate(parseFormula(check.fail_when), walk.scope));
    } catch (error) {
      if (!(error instanceof CalcError) && !(error instanceof FormulaRefusal)) throw error;
    }
    if (failed) errors.set(check.target, fill(check.message, walk));
  }
  return page.questions.filter((q) => errors.has(q.key)).map((q) => ({ key: q.key, message: errors.get(q.key) as string, page: pageKey }));
}

const isText = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT;

/** Whether a committed value fits its question; files and calculated fields are never committed. */
export function answerFits(question: Question, value: unknown): boolean {
  if (question.type === "file" || question.type === "calculated") return false;
  if (value === null) return true;
  const values = (question.options ?? []).map((o) => o.value);
  switch (question.type) {
    case "short_text":
    case "long_text":
    case "number":
    case "date":
      return isText(value);
    case "choice":
    case "dropdown":
      return typeof value === "string" && values.includes(value);
    case "checkbox":
      return Array.isArray(value) && value.every((v) => values.includes(v)) && new Set(value).size === value.length;
    case "ranking":
      return Array.isArray(value) && value.length === values.length && values.every((v) => value.includes(v));
    case "scale": {
      if (typeof value !== "string" || !/^-?\d+$/.test(value)) return false;
      const n = Number(value);
      return n >= Number(question.min) && n <= Number(question.max);
    }
    case "grid": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const rows = (question.rows ?? []).map((r) => r.value);
      const columns = (question.columns ?? []).map((c) => c.value);
      return Object.entries(value).every(([row, column]) => rows.includes(row) && typeof column === "string" && columns.includes(column));
    }
  }
}

/** Whether a kept answer is still allowed by a (possibly newer) question. */
export function answerStillValid(question: Question, value: AnswerValue): boolean {
  if (question.type === "file") return typeof value === "object" && !Array.isArray(value) && "size" in value;
  if (!answerFits(question, value)) return false;
  if (question.type === "number" || question.type === "date") return fieldProblem({ ...question, required: false }, value) === null;
  return true;
}
