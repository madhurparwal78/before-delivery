import { allQuestions } from "../../shared/changes.js";
import { isRealDate } from "../../shared/formats.js";
import type { Definition, FormCheck, Page, Question, QuestionType } from "../../shared/types.js";
import { config } from "../config.js";
import { Decimal } from "./decimal.js";
import { FormulaRefusal, parseFormula, visitRefs } from "./formula.js";

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export const INSERTION_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)(?:\.([^{}]+?))?\}\}/g;

const COMMON_FIELDS = ["key", "type", "label", "help", "required", "show_rule", "note"];

export const TYPE_FIELDS: Record<QuestionType, string[]> = {
  short_text: ["min_length", "max_length", "pattern"],
  long_text: ["min_length", "max_length", "pattern"],
  number: ["min", "max", "decimals"],
  choice: ["options", "shuffle"],
  dropdown: ["options", "shuffle"],
  checkbox: ["options", "shuffle", "min_selected", "max_selected"],
  grid: ["rows", "columns"],
  ranking: ["options"],
  scale: ["min", "max", "min_label", "max_label"],
  date: ["min", "max"],
  file: ["max_bytes", "accept"],
  calculated: ["formula", "places", "prefix", "suffix", "hidden"],
};

const REQUIRED_FIELDS: Partial<Record<QuestionType, string[]>> = {
  choice: ["options"],
  dropdown: ["options"],
  checkbox: ["options"],
  ranking: ["options"],
  grid: ["rows", "columns"],
  scale: ["min", "max"],
  calculated: ["formula"],
};

export function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TYPE_FIELDS, value);
}

export type StructureCode = "CHANGE_INVALID" | "DUPLICATE_KEY" | "VALIDATION_FAILED";

export class StructureError extends Error {
  constructor(
    readonly code: StructureCode,
    message: string,
    readonly key: string | null = null,
  ) {
    super(message);
  }
}

function fail(message: string): never {
  throw new StructureError("CHANGE_INVALID", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === "string";
const isOptString = (v: unknown): boolean => v === undefined || v === null || typeof v === "string";
const isWhole = (v: unknown, min = 0): boolean => typeof v === "number" && Number.isInteger(v) && v >= min;
const isNumeric = (v: unknown): boolean =>
  (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && Decimal.parse(v) !== null);

function checkUnknown(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const field of Object.keys(obj)) if (!allowed.includes(field)) fail(`${where}: unknown field ${field}.`);
}

function checkOptions(value: unknown, where: string, field: string): void {
  if (!Array.isArray(value) || value.length === 0) fail(`${where}: ${field} must be a list of {value, label}.`);
  const seen = new Set<string>();
  for (const option of value) {
    if (!isRecord(option) || !isString(option.value) || !isString(option.label) || option.value === "")
      fail(`${where}: ${field} must be a list of {value, label}.`);
    checkUnknown(option, ["value", "label"], where);
    if (seen.has(option.value)) fail(`${where}: ${field} repeats the value ${option.value}.`);
    seen.add(option.value);
  }
}

function checkRule(value: unknown, where: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value) || !isString(value.name) || !isString(value.when)) fail(`${where}: show_rule needs a name and when.`);
  checkUnknown(value, ["name", "when"], where);
}

export function checkQuestionKey(key: unknown): void {
  if (!isString(key) || !KEY_PATTERN.test(key))
    throw new StructureError("VALIDATION_FAILED", "Use lower-case letters, digits and underscores, starting with a letter.", isString(key) ? key : "");
}

/** Validates the shape of one question. */
export function checkQuestion(value: unknown): asserts value is Question {
  if (!isRecord(value)) fail("A question must be an object.");
  checkQuestionKey(value.key);
  const key = value.key as string;
  const where = `Question ${key}`;
  if (!isQuestionType(value.type)) fail(`${where}: unknown type ${String(value.type)}.`);
  const type = value.type;
  checkUnknown(value, [...COMMON_FIELDS, ...TYPE_FIELDS[type]], where);
  for (const field of REQUIRED_FIELDS[type] ?? []) if (value[field] === undefined) fail(`${where}: ${field} is required.`);
  if (!isString(value.label)) fail(`${where}: label is required.`);
  if (!isOptString(value.help) || !isOptString(value.note)) fail(`${where}: help and note must be text.`);
  if (value.required !== undefined && typeof value.required !== "boolean") fail(`${where}: required must be true or false.`);
  checkRule(value.show_rule, where);
  for (const field of ["options", "rows", "columns"]) if (value[field] !== undefined) checkOptions(value[field], where, field);
  for (const field of ["min_length", "max_length", "decimals", "min_selected", "max_selected", "places"])
    if (value[field] !== undefined && !isWhole(value[field])) fail(`${where}: ${field} must be a whole number.`);
  for (const field of ["shuffle", "hidden"])
    if (value[field] !== undefined && typeof value[field] !== "boolean") fail(`${where}: ${field} must be true or false.`);
  for (const field of ["prefix", "suffix", "min_label", "max_label"])
    if (!isOptString(value[field])) fail(`${where}: ${field} must be text.`);
  if (value.pattern !== undefined && value.pattern !== null && !["email", "phone", "digits", "letters"].includes(String(value.pattern)))
    fail(`${where}: unknown pattern ${String(value.pattern)}.`);
  if (type === "calculated" && !isString(value.formula)) fail(`${where}: formula must be text.`);
  if (type === "number")
    for (const field of ["min", "max"]) if (value[field] !== undefined && !isNumeric(value[field])) fail(`${where}: ${field} must be a number.`);
  if (type === "scale") {
    const min = Number(value.min);
    const max = Number(value.max);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max || max - min > 100)
      fail(`${where}: min and max must be whole numbers with min below max.`);
  }
  if (type === "date")
    for (const field of ["min", "max"])
      if (value[field] !== undefined && !(isString(value[field]) && isRealDate(value[field] as string)))
        fail(`${where}: ${field} must be a date written YYYY-MM-DD.`);
  if (type === "file") {
    if (value.max_bytes !== undefined && !(isWhole(value.max_bytes, 1) && (value.max_bytes as number) <= config.uploadMaxBytes))
      fail(`${where}: max_bytes must be from 1 to ${config.uploadMaxBytes}.`);
    if (
      value.accept !== undefined &&
      !(Array.isArray(value.accept) && value.accept.length > 0 && value.accept.every((a) => ["pdf", "png", "jpeg"].includes(String(a))))
    )
      fail(`${where}: accept must list pdf, png or jpeg.`);
  }
}

function checkPage(value: unknown): asserts value is Page {
  if (!isRecord(value)) fail("A page must be an object.");
  if (!isString(value.key) || !KEY_PATTERN.test(value.key)) fail(`Page keys use lower-case letters, digits and underscores.`);
  const where = `Page ${value.key}`;
  checkUnknown(value, ["key", "title", "questions", "show_rule", "jumps"], where);
  if (!isString(value.title)) fail(`${where}: title is required.`);
  if (!Array.isArray(value.questions)) fail(`${where}: questions must be a list.`);
  value.questions.forEach((q) => checkQuestion(q));
  checkRule(value.show_rule, where);
  if (value.jumps !== undefined && value.jumps !== null) {
    if (!Array.isArray(value.jumps)) fail(`${where}: jumps must be a list.`);
    for (const jump of value.jumps) {
      if (!isRecord(jump) || !isString(jump.name) || !isString(jump.when) || !isString(jump.to))
        fail(`${where}: a jump needs a name, when and to.`);
      checkUnknown(jump, ["name", "when", "to"], where);
    }
  }
}

function checkChecks(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) fail("checks must be a list.");
  for (const check of value) {
    if (!isRecord(check)) fail("A check must be an object.");
    checkUnknown(check, ["name", "page", "target", "fail_when", "message"], "Check");
    if (![check.name, check.page, check.target, check.fail_when, check.message].every(isString))
      fail("A check needs a name, page, target, fail_when and message.");
  }
}

/** Validates the shape of a whole definition (not its formulas). */
export function checkDefinition(value: unknown): asserts value is Definition {
  if (!isRecord(value)) fail("A definition must be an object.");
  checkUnknown(value, ["title", "intro", "pages", "checks"], "Form");
  if (!isString(value.title)) fail("Form: title is required.");
  if (!isOptString(value.intro)) fail("Form: intro must be text.");
  if (!Array.isArray(value.pages) || value.pages.length === 0) fail("Form: pages must be a non-empty list.");
  value.pages.forEach((p) => checkPage(p));
  const pageKeys = new Set<string>();
  for (const page of value.pages as Page[]) {
    if (pageKeys.has(page.key)) fail(`Page ${page.key} appears twice.`);
    pageKeys.add(page.key);
  }
  const keys = new Set<string>();
  for (const q of allQuestions(value as unknown as Definition)) {
    if (keys.has(q.key)) throw new StructureError("DUPLICATE_KEY", "That key is already used.", q.key);
    keys.add(q.key);
  }
  checkChecks(value.checks);
}

/* ---------- Save-time analysis ---------- */

export interface LocatedProblem {
  /** The question key, page key or `form` the problem belongs to. */
  key: string;
  field: string;
  message: string;
}

interface Position {
  question: Question;
  page: number;
  index: number;
}

type Scope =
  | { kind: "calculated"; self: Position }
  | { kind: "question_rule"; self: Position }
  | { kind: "page_rule"; page: number }
  | { kind: "jump"; page: number }
  | { kind: "check"; page: number };

function positions(def: Definition): Map<string, Position> {
  const map = new Map<string, Position>();
  let index = 0;
  def.pages.forEach((page, p) => page.questions.forEach((question) => map.set(question.key, { question, page: p, index: index++ })));
  return map;
}

function allowedBefore(scope: Scope, pos: Position): boolean {
  switch (scope.kind) {
    case "calculated":
    case "question_rule":
      return pos.index < scope.self.index;
    case "page_rule":
      return pos.page < scope.page;
    case "jump":
    case "check":
      return pos.page <= scope.page;
  }
}

const LIST_FUNCTIONS: readonly string[] = ["HAS", "TICKED", "BLANK", "COUNT"];
const PRESENCE_FUNCTIONS: readonly string[] = ["BLANK", "COUNT"];

/** Returns the refusal for a formula at a place in the form, or null when it is accepted. */
export function formulaRefusal(source: string, scope: Scope, map: Map<string, Position>): string | null {
  try {
    const node = parseFormula(source);
    let refusal: string | null = null;
    visitRefs(node, (ref) => {
      if (refusal) return;
      const name = ref.row === null ? ref.key : `${ref.key}.${ref.row}`;
      const pos = map.get(ref.key);
      const rowOk = ref.row === null || (pos?.question.type === "grid" && (pos.question.rows ?? []).some((r) => r.value === ref.row));
      if (!pos || !rowOk) refusal = `Column ${ref.col}: there is no question called {${name}}.`;
      else if (scope.kind === "calculated" && pos.question === scope.self.question)
        refusal = `Column ${ref.col}: a calculated field cannot use itself.`;
      else if (scope.kind === "question_rule" && pos.question === scope.self.question)
        refusal = `Column ${ref.col}: a rule cannot use the question it belongs to.`;
      else if (!allowedBefore(scope, pos)) refusal = `Column ${ref.col}: {${name}} comes later in the form, so it cannot be used here.`;
      else if (ref.row === null && pos.question.type === "checkbox" && !LIST_FUNCTIONS.includes(ref.parentCall ?? ""))
        refusal = `Column ${ref.col}: {${name}} can only be used inside HAS, TICKED, BLANK or COUNT.`;
      else if (
        ref.row === null &&
        ["ranking", "file", "grid"].includes(pos.question.type) &&
        !PRESENCE_FUNCTIONS.includes(ref.parentCall ?? "")
      )
        refusal = `Column ${ref.col}: {${name}} can only be used inside BLANK or COUNT.`;
    });
    return refusal;
  } catch (error) {
    if (error instanceof FormulaRefusal) return error.message;
    throw error;
  }
}

function insertionRefusal(textValue: string, allowed: (pos: Position) => boolean, map: Map<string, Position>): string | null {
  for (const match of textValue.matchAll(INSERTION_PATTERN)) {
    const [whole, key, row] = match;
    const inner = whole.slice(2, -2);
    const pos = map.get(key);
    if (!pos || (row !== undefined && !(pos.question.type === "grid" && (pos.question.rows ?? []).some((r) => r.value === row))))
      return `{{${inner}}} is not a question in this form.`;
    if (!allowed(pos)) return `{{${inner}}} comes later in the form, so it cannot be inserted here.`;
    if (row === undefined && ["ranking", "file", "grid"].includes(pos.question.type)) return `{{${inner}}} cannot be inserted.`;
  }
  return null;
}

/** Every save-time refusal in a definition, in form order. */
export function locatedProblems(def: Definition): LocatedProblem[] {
  const map = positions(def);
  const problems: LocatedProblem[] = [];
  const add = (key: string, field: string, message: string | null): void => {
    if (message) problems.push({ key, field, message });
  };
  def.pages.forEach((page, p) => {
    add(page.key, "title", insertionRefusal(page.title, (pos) => pos.page < p, map));
    if (page.show_rule) add(page.key, "show_rule", formulaRefusal(page.show_rule.when, { kind: "page_rule", page: p }, map));
    for (const question of page.questions) {
      const self = map.get(question.key) as Position;
      const before = (pos: Position): boolean => pos.index < self.index;
      add(question.key, "label", insertionRefusal(question.label, before, map));
      if (question.help) add(question.key, "help", insertionRefusal(question.help, before, map));
      if (question.show_rule) add(question.key, "show_rule", formulaRefusal(question.show_rule.when, { kind: "question_rule", self }, map));
      if (question.type === "calculated") add(question.key, "formula", formulaRefusal(question.formula ?? "", { kind: "calculated", self }, map));
    }
    for (const jump of page.jumps ?? []) {
      const to = def.pages.findIndex((x) => x.key === jump.to);
      add(page.key, "jumps", formulaRefusal(jump.when, { kind: "jump", page: p }, map) ?? (to > p ? null : "A jump can only go to a later page."));
    }
  });
  for (const check of def.checks ?? []) add(check.target, "checks", checkRefusal(def, check, map));
  return problems;
}

function checkRefusal(def: Definition, check: FormCheck, map: Map<string, Position>): string | null {
  const page = def.pages.findIndex((p) => p.key === check.page);
  if (page < 0) return `There is no page called ${check.page}.`;
  if (!map.has(check.target)) return `There is no question called {${check.target}}.`;
  return (
    formulaRefusal(check.fail_when, { kind: "check", page }, map) ??
    insertionRefusal(check.message, (pos) => pos.page <= page, map)
  );
}

/** The first save-time refusal matching a change's place in the form, if any. */
export function firstProblem(def: Definition, match: (problem: LocatedProblem) => boolean): LocatedProblem | null {
  return locatedProblems(def).find(match) ?? null;
}
