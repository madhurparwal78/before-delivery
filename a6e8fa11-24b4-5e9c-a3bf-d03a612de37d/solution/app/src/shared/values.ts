// Cell values, error values and the cell-input rules (Business rules · Cell inputs and values).

type ErrorCode = "#VALUE!" | "#DIV/0!" | "#REF!" | "#NAME?" | "#ERROR!" | "#CYCLE" | "#LIMIT";

export interface ErrorValue {
  readonly error: ErrorCode;
}

export type Scalar = number | string | boolean;
/** `null` is an empty cell. */
export type CellValue = Scalar | ErrorValue | null;

export function isError(value: unknown): value is ErrorValue {
  return typeof value === "object" && value !== null && "error" in value;
}

export function errorValue(code: ErrorCode): ErrorValue {
  return { error: code };
}

export const NUMBER_FORMATS = ["general", "0", "0.0", "0.00", "0.000", "0.0%", "date"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export interface CellFormat {
  numberFormat: NumberFormat;
  bold: boolean;
}

export const DEFAULT_FORMAT: CellFormat = { numberFormat: "general", bold: false };

export function isNumberFormat(value: unknown): value is NumberFormat {
  return typeof value === "string" && (NUMBER_FORMATS as readonly string[]).includes(value);
}

const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Day count from 1899-12-30. */
export function serialOfDate(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - EPOCH_MS) / DAY_MS);
}

export function dateTextOfSerial(serial: number): string {
  const d = new Date(EPOCH_MS + Math.floor(serial) * DAY_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${m}-${day}`;
}

type InputKind =
  | { kind: "empty" }
  | { kind: "formula"; source: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string };

const NUMBER_INPUT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" when it names a real calendar date. */
function parseDateText(text: string): number | null {
  const m = DATE_INPUT.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return serialOfDate(y, mo, d);
}

/** Classifies what a member typed into a cell. */
export function classifyInput(input: string): InputKind {
  if (input === "") return { kind: "empty" };
  if (input.startsWith("=")) return { kind: "formula", source: input.slice(1) };
  if (input.startsWith("'")) return { kind: "text", value: input.slice(1) };
  if (NUMBER_INPUT.test(input)) return { kind: "number", value: Number(input) };
  const date = parseDateText(input);
  if (date !== null) return { kind: "date", value: date };
  const upper = input.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") return { kind: "boolean", value: upper === "TRUE" };
  return { kind: "text", value: input };
}

/** A date input gives its cell the date format; every other input keeps the cell's format. */
export function formatForInput(input: string, format: CellFormat): CellFormat {
  return classifyInput(input).kind === "date" ? { ...format, numberFormat: "date" } : format;
}

/** The input that stores `text` as plain text, whatever it looks like. */
export function textInput(text: string): string {
  const kind = classifyInput(text).kind;
  return kind === "text" && !text.startsWith("'") ? text : `'${text}`;
}
