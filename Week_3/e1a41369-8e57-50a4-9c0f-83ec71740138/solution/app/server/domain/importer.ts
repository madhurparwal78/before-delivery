import { DIFFICULTIES, WEEKDAYS, type Difficulty, type TaskType, type Weekday } from "../../shared/api.js";
import { priceCentsOf, titleOf } from "./taskinput.js";

export const IMPORT_LIMIT = 100_000;
const HEADER = "DEEDLIST 1";
const WEEKDAY_LIST = WEEKDAYS.join(", ");
const FIELD_COUNTS: Record<TaskType, { expected: number[]; label: string }> = {
  habit: { expected: [3], label: "3" },
  daily: { expected: [4], label: "4" },
  todo: { expected: [3, 4], label: "3 or 4" },
  reward: { expected: [3], label: "3" },
};

interface ImportedTask {
  line: number;
  type: TaskType;
  title: string;
  difficulty: Difficulty | null;
  weekdays: Weekday[] | null;
  checklist: string[];
  priceCents: number | null;
}

interface ImportError {
  line: number;
  message: string;
}

interface Parsed {
  tasks: ImportedTask[];
  errors: ImportError[];
}

/** The import file must be valid UTF-8 without NUL bytes. */
export function readText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function parseWeekdays(field: string): Weekday[] | undefined {
  const names = field.split(",").map((name) => name.trim());
  const chosen = WEEKDAYS.filter((day) => names.includes(day));
  return chosen.length === names.length && new Set(names).size === names.length ? chosen : undefined;
}

function parseLine(line: number, text: string): { task?: ImportedTask; errors: ImportError[] } {
  const fields = text.split("|").map((field) => field.trim());
  const type = (["habit", "daily", "todo", "reward"] as const).find((candidate) => candidate === fields[0]);
  const refuse = (message: string): ImportError => ({ line, message: `Line ${line}: ${message}` });
  if (!type) return { errors: [refuse(`unknown task type "${fields[0]}"`)] };
  const { expected, label } = FIELD_COUNTS[type];
  if (!expected.includes(fields.length)) return { errors: [refuse(`expected ${label} fields, found ${fields.length}`)] };
  const errors: ImportError[] = [];
  const title = titleOf(fields[1]);
  if (title === undefined) errors.push(refuse("title must be 1 to 80 characters"));
  let difficulty: Difficulty | null = null;
  let weekdays: Weekday[] | null = null;
  let priceCents: number | null = null;
  if (type === "reward") {
    const price = /^\d+(\.\d{1,2})?$/.test(fields[2]!) ? priceCentsOf(Number(fields[2])) : undefined;
    if (price === undefined) errors.push(refuse("price must be a number from 0.01 to 9999.99"));
    else priceCents = price;
  } else {
    difficulty = DIFFICULTIES.find((candidate) => candidate === fields[2]) ?? null;
    if (difficulty === null) errors.push(refuse("difficulty must be trivial, easy, medium or hard"));
  }
  if (type === "daily") {
    weekdays = parseWeekdays(fields[3]!) ?? null;
    if (weekdays === null) errors.push(refuse(`weekdays must be chosen from ${WEEKDAY_LIST}`));
  }
  if (errors.length > 0) return { errors };
  const checklist = type === "todo" && fields[3] ? fields[3].split(";").map((item) => item.trim()).filter(Boolean) : [];
  return { task: { line, type, title: title!, difficulty, weekdays, checklist, priceCents }, errors };
}

/** Check a `.deedlist` file: any error rejects the whole file, with every error listed by line. */
export function parseDeedlist(text: string): Parsed {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== HEADER) return { tasks: [], errors: [{ line: 1, message: "Line 1: the first line must be DEEDLIST 1" }] };
  const tasks: ImportedTask[] = [];
  const errors: ImportError[] = [];
  lines.slice(1).forEach((raw, index) => {
    if (raw.trim() === "" || raw.trim().startsWith("#")) return;
    const parsed = parseLine(index + 2, raw);
    if (parsed.task) tasks.push(parsed.task);
    errors.push(...parsed.errors);
  });
  return { tasks, errors };
}
