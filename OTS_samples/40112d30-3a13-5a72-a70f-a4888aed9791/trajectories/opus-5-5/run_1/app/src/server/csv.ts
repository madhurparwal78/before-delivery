import type { FileAnswer, Question } from "../shared/types.js";
import { isoWithOffset } from "./clock.js";
import { Decimal } from "./engine/decimal.js";
import { isAnswered } from "./engine/walk.js";
import { loadHistory, type SubmittedRow } from "./history.js";

interface Cell {
  text: string;
  /** Numbers, dates and the fixed columns are written as they are. */
  literal: boolean;
}

const FORMULA_START = /^[=+\-@\t\r]/;

function quote(cell: Cell): string {
  const text = !cell.literal && FORMULA_START.test(cell.text) ? `'${cell.text}` : cell.text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const literal = (text: string): Cell => ({ text, literal: true });
const plain = (text: string): Cell => ({ text, literal: false });
const EMPTY = literal("");

interface Column {
  name: string;
  key: string;
  row: string | null;
}

function columnsFor(questions: Question[]): Column[] {
  return questions.flatMap((q): Column[] =>
    q.type === "grid"
      ? (q.rows ?? []).map((r) => ({ name: `${q.key}.${r.value}`, key: q.key, row: r.value }))
      : [{ name: q.key, key: q.key, row: null }],
  );
}

function cellFor(question: Question | undefined, column: Column, response: SubmittedRow): Cell {
  if (!question) return EMPTY;
  if (question.type === "calculated") {
    const value = response.calc_values[question.key]?.value ?? null;
    if (value === null) return EMPTY;
    const number = Decimal.parse(value);
    if (number) return literal(question.places === undefined ? number.toText() : number.toFixed(question.places));
    const shown = response.calc_values[question.key].text;
    return plain(shown.slice((question.prefix ?? "").length, shown.length - (question.suffix ?? "").length));
  }
  const answer = response.answers[question.key];
  if (!isAnswered(answer)) return EMPTY;
  switch (question.type) {
    case "number":
    case "scale":
      return literal(Decimal.parse(answer as string)?.toText() ?? (answer as string));
    case "date":
      return literal((answer as string).trim());
    case "checkbox":
      return plain((question.options ?? []).filter((o) => (answer as string[]).includes(o.value)).map((o) => o.value).join("; "));
    case "ranking":
      return plain((answer as string[]).join(" > "));
    case "file":
      return plain((answer as FileAnswer).name);
    case "grid": {
      const value = column.row === null ? undefined : (answer as Record<string, string>)[column.row];
      return value ? plain(value) : EMPTY;
    }
    default:
      return plain(answer as string);
  }
}

/** The CSV file: UTF-8 without a byte-order mark, CRLF line ends and RFC 4180 quoting. */
export async function buildCsv(formId: string, liveEdition: number | null): Promise<{ text: string; count: number }> {
  const history = await loadHistory(formId, liveEdition);
  const columns = columnsFor(history.questions);
  const lines = [[literal("response_id"), literal("submitted_at"), literal("edition"), ...columns.map((c) => literal(c.name))]];
  for (const response of history.responses) {
    const def = history.editions.get(response.edition);
    const own = new Map((def?.pages ?? []).flatMap((p) => p.questions).map((q) => [q.key, q]));
    lines.push([
      literal(response.id),
      literal(isoWithOffset(response.submitted_at)),
      literal(String(response.edition)),
      ...columns.map((c) => cellFor(own.get(c.key), c, response)),
    ]);
  }
  return { text: lines.map((cells) => cells.map(quote).join(",")).join("\r\n") + "\r\n", count: history.responses.length };
}
