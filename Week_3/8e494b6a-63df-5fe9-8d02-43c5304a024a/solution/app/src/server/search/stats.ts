// Field lists, field statistics (Business rules G) and query bar suggestions (Business rules F).
import { roundHalfAway } from "./scoring";
import { analyze } from "./analysis";
import { conflictSentence, coveredGenerations, typesOfField, type StreamContext } from "./context";
import { errors } from "../errors";
import { eventValues } from "./filters";
import type { FieldType, Scalar } from "./fields";
import type { Matched } from "./run";
import type { StoredEvent } from "./events";

interface FieldInfo {
  field: string;
  type: FieldType | "conflict";
  conflict?: string;
}

/** The fields of the generations that hold events in the range, alphabetical; a type conflict names its sentence. */
export function fieldList(ctx: StreamContext, from: number, to: number): FieldInfo[] {
  const names = new Set<string>(["@timestamp"]);
  for (const generation of coveredGenerations(ctx, from, to)) for (const field of ctx.types.get(generation.number)?.keys() ?? []) names.add(field);
  return [...names].sort().map((field) => {
    const sentence = conflictSentence(ctx, field, from, to);
    return sentence ? { field, type: "conflict", conflict: sentence } : { field, type: typesOfField(ctx, field)[0] ?? "text" };
  });
}

interface TopValue {
  value: Scalar;
  count: number;
  share: string;
}

const compareValues = (a: Scalar, b: Scalar): number =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export function fieldStatistics(ctx: StreamContext, matched: Matched[], field: string, from: number, to: number) {
  const sentence = conflictSentence(ctx, field, from, to);
  if (sentence) throw errors.fieldConflict(sentence);
  const counts = new Map<string, { value: Scalar; count: number }>();
  let present = 0;
  for (const { event } of matched) {
    const values = eventValues(event, field);
    if (values.length === 0) continue;
    present++;
    for (const value of new Map(values.map((v) => [`${typeof v}:${v}`, v])).values()) {
      const key = `${typeof value}:${value}`;
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { value, count: 1 });
    }
  }
  const top: TopValue[] = [...counts.values()]
    .sort((a, b) => b.count - a.count || compareValues(a.value, b.value))
    .slice(0, 5)
    .map(({ value, count }) => ({ value, count, share: roundHalfAway((count / present) * 100, 1).toFixed(1) }));
  return { field, present, total: matched.length, top };
}

const SUGGESTION_LIMIT = 10;
const RANGE_OPERATORS = [":", ">", ">=", "<", "<="];
const VALUE_CONTEXT = /(?:^|[\s({])([A-Za-z0-9_.@-]+)(:|>=|<=|>|<)("[^"]*|[^\s()"{}]*)$/;
const NAME_CONTEXT = /(?:^|[\s({])([A-Za-z0-9_.@-]*)$/;

interface Suggestion {
  label: string;
  insert: string;
  count?: number;
}

const quoteIfNeeded = (value: string): string => (/^[A-Za-z0-9_./-]*$/.test(value) ? value : `"${value.replace(/["\\]/g, "\\$&")}"`);

function valueSuggestions(ctx: StreamContext, events: StoredEvent[], field: string, typed: string): Suggestion[] {
  const isText = typesOfField(ctx, field).includes("text");
  const counts = new Map<string, number>();
  for (const event of events) {
    const seen = new Set<string>();
    for (const value of eventValues(event, field)) {
      if (isText && typeof value === "string") for (const token of analyze("standard", value)) seen.add(token.token);
      else seen.add(String(value));
    }
    for (const value of seen) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const prefix = typed.toLowerCase();
  return [...counts]
    .filter(([value]) => value.toLowerCase().startsWith(prefix))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, SUGGESTION_LIMIT)
    .map(([value, count]) => ({ label: value, insert: quoteIfNeeded(value), count }));
}

export function suggest(ctx: StreamContext, events: StoredEvent[], before: string, from: number, to: number): { kind: "field" | "operator" | "value" | "none"; items: Suggestion[] } {
  const value = VALUE_CONTEXT.exec(before);
  if (value) {
    const field = value[1] as string;
    if (typesOfField(ctx, field).length === 0) return { kind: "none", items: [] };
    return { kind: "value", items: valueSuggestions(ctx, events, field, (value[3] as string).replace(/^"/, "")) };
  }
  const name = NAME_CONTEXT.exec(before);
  if (!name) return { kind: "none", items: [] };
  const fragment = name[1] as string;
  const fields = fieldList(ctx, from, to);
  const known = fields.find((info) => info.field === fragment);
  if (known) {
    const rangeable = typesOfField(ctx, fragment).some((type) => type === "number" || type === "date");
    return { kind: "operator", items: (rangeable ? RANGE_OPERATORS : [":"]).map((op) => ({ label: op, insert: op })) };
  }
  const startsClause = fragment !== "" || before === "" || /[({]$/.test(before) || /\b(AND|OR|NOT)\s+$/.test(before);
  if (!startsClause) return { kind: "none", items: [] };
  const items = fields.filter((info) => info.field.startsWith(fragment)).slice(0, SUGGESTION_LIMIT).map((info) => ({ label: info.field, insert: info.field }));
  return { kind: "field", items };
}
