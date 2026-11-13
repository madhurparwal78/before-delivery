import { DIFFICULTIES, WEEKDAYS, type Difficulty, type TaskType, type Weekday } from "../../shared/api.js";
import { Message, invalid } from "../errors.js";

const TITLE_MAX = 80;
const PRICE_MAX_CENTS = 999_999;
const TYPES: readonly TaskType[] = ["habit", "daily", "todo", "reward"];

export const titleOf = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const title = value.trim();
  const length = Array.from(title).length;
  return length >= 1 && length <= TITLE_MAX ? title : undefined;
};

const difficultyOf = (value: unknown): Difficulty | undefined => DIFFICULTIES.find((difficulty) => difficulty === value);

export function weekdaysOf(value: unknown): Weekday[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const chosen = WEEKDAYS.filter((day) => value.includes(day));
  return chosen.length > 0 && chosen.length === new Set(value).size ? chosen : undefined;
}

export function priceCentsOf(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 1e-6 && cents >= 1 && cents <= PRICE_MAX_CENTS ? cents : undefined;
}

interface ChecklistInput {
  id?: string;
  text: string;
}

function checklistOf(value: unknown): ChecklistInput[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistInput[] = [];
  for (const entry of value) {
    const input = typeof entry === "string" ? { text: entry } : (entry as { id?: unknown; text?: unknown } | null);
    const text = typeof input?.text === "string" ? input.text.trim() : "";
    if (text) items.push({ id: typeof (input as { id?: unknown }).id === "string" ? (input as { id: string }).id : undefined, text });
  }
  return items;
}

interface TaskInput {
  type: TaskType;
  title: string;
  difficulty: Difficulty | null;
  weekdays: Weekday[] | null;
  checklist: ChecklistInput[];
  priceCents: number | null;
}

export function parseNewTask(input: Record<string, unknown>): TaskInput {
  const type = TYPES.find((candidate) => candidate === input.type);
  if (!type) throw invalid({ type: Message.type });
  const errors: Record<string, string> = {};
  const title = titleOf(input.title);
  if (title === undefined) errors.title = Message.title;
  const difficulty = type === "reward" ? null : (difficultyOf(input.difficulty) ?? null);
  if (type !== "reward" && difficulty === null) errors.difficulty = Message.difficulty;
  const weekdays = type === "daily" ? (weekdaysOf(input.weekdays) ?? null) : null;
  if (type === "daily" && weekdays === null) errors.weekdays = Message.weekdays;
  const priceCents = type === "reward" ? (priceCentsOf(input.price) ?? null) : null;
  if (type === "reward" && priceCents === null) errors.price = Message.price;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  return { type, title: title!, difficulty, weekdays, checklist: type === "todo" ? checklistOf(input.checklist) : [], priceCents };
}

interface TaskPatch {
  title?: string;
  difficulty?: Difficulty;
  weekdays?: Weekday[];
  checklist?: ChecklistInput[];
  priceCents?: number;
}

/** Only the fields that fit the task's type are read; each present field is validated. */
export function parseTaskPatch(input: Record<string, unknown>, type: TaskType): TaskPatch {
  const errors: Record<string, string> = {};
  const patch: TaskPatch = {};
  if ("title" in input) {
    patch.title = titleOf(input.title);
    if (patch.title === undefined) errors.title = Message.title;
  }
  if ("difficulty" in input && type !== "reward") {
    patch.difficulty = difficultyOf(input.difficulty);
    if (patch.difficulty === undefined) errors.difficulty = Message.difficulty;
  }
  if ("weekdays" in input && type === "daily") {
    patch.weekdays = weekdaysOf(input.weekdays);
    if (patch.weekdays === undefined) errors.weekdays = Message.weekdays;
  }
  if ("price" in input && type === "reward") {
    patch.priceCents = priceCentsOf(input.price);
    if (patch.priceCents === undefined) errors.price = Message.price;
  }
  if ("checklist" in input && type === "todo") patch.checklist = checklistOf(input.checklist);
  if (Object.keys(errors).length > 0) throw invalid(errors);
  return patch;
}
