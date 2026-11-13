import type { Craft, Mode, Side } from "../../common/types";

export interface WorkedItem {
  key: string;
  text: string;
  counted: boolean;
  uses: number;
  makes: number;
  colour: string;
  cols: number[];
}

export interface LineToken {
  text: string;
  cols: number[];
  inRepeat: boolean;
}

export interface ComputedLine {
  label: string;
  body: string;
  count: string;
  text: string;
  tokens: LineToken[];
}

interface RepeatPlan {
  period: number;
  before: number;
  repeats: number;
}

const itemsEqual = (a: WorkedItem, b: WorkedItem): boolean =>
  a.text === b.text && a.colour === b.colour;

/**
 * The one place a written line is decided: label, runs, repeat detection and
 * closing count. Every view renders the result of this function.
 */
export function computeLine(row: number, side: Side, items: WorkedItem[], mode: Mode): ComputedLine {
  const label =
    mode === "round" ? `Rnd ${row}:` : `Row ${row} (${side === "RS" ? "RS" : "WS"}):`;
  const multi = items.some((item) => item.colour !== items[0].colour);
  const plan = repeatPlan(items);
  const body = plan
    ? bodyWithRepeat(items, plan, multi)
    : `${joinRuns(items, 0, items.length, multi)}.`;
  const made = items.reduce((total, item) => total + item.makes, 0);
  const count = made === 1 ? " (1 st)" : ` (${made} sts)`;
  return {
    label,
    body,
    count,
    text: `${label} ${body}${count}`,
    tokens: lineTokens(items, plan, multi),
  };
}

function bodyWithRepeat(items: WorkedItem[], plan: RepeatPlan, multi: boolean): string {
  const head = plan.before > 0 ? `${joinRuns(items, 0, plan.before, multi)}, ` : "";
  const unit = joinRuns(items, plan.before, plan.before + plan.period, multi);
  const tailStart = plan.before + plan.period * plan.repeats;
  const tail = items.slice(tailStart);
  const tailUses = tail.reduce((total, item) => total + item.uses, 0);
  const tailText = tail.length > 0 ? joinRuns(tail, 0, tail.length, multi) : "";
  let ending: string;
  if (tail.length === 0) ending = "end.";
  else if (tailUses === 0) ending = `end, ${tailText}.`;
  else if (tailUses === 1) ending = `last st, ${tailText}.`;
  else ending = `last ${tailUses} sts, ${tailText}.`;
  return `${head}*${unit}; rep from * to ${ending}`;
}

/** The first (period, start) that wins per the published rule, or null. */
export function repeatPlan(items: WorkedItem[]): RepeatPlan | null {
  const maxPeriod = Math.floor(items.length / 2);
  for (let period = 2; period <= maxPeriod; period++) {
    for (let start = 0; start + period <= items.length; start++) {
      const unit = items.slice(start, start + period);
      if (unit.every((item) => itemsEqual(item, unit[0]))) continue;
      let repeats = 1;
      let cursor = start + period;
      while (
        cursor + period <= items.length &&
        items.slice(cursor, cursor + period).every((item, index) => itemsEqual(item, unit[index]))
      ) {
        repeats++;
        cursor += period;
      }
      if (repeats >= 2) return { period, before: start, repeats };
    }
  }
  return null;
}

function joinRuns(items: WorkedItem[], from: number, to: number, multi: boolean): string {
  const parts: string[] = [];
  let index = from;
  while (index < to) {
    let count = 1;
    while (index + count < to && itemsEqual(items[index + count], items[index])) count++;
    parts.push(formatRun(items[index], count, multi));
    index += count;
  }
  return parts.join(", ");
}

export function formatRun(item: WorkedItem, count: number, multi: boolean): string {
  const base = item.counted ? `${item.text}${count}` : count === 1 ? item.text : `${item.text} x${count}`;
  return multi ? `${base} in ${item.colour}` : base;
}

/** Tokens for the twin lift: one per printed run, with its cells in reading order. */
function lineTokens(items: WorkedItem[], plan: RepeatPlan | null, multi: boolean): LineToken[] {
  if (!plan) return runTokens(items, 0, items.length, multi, false);
  const tokens: LineToken[] = [];
  tokens.push(...runTokens(items, 0, plan.before, multi, false));
  // unit tokens: runs inside the unit, each lifting that position in every repeat
  let index = plan.before;
  const unitEnd = plan.before + plan.period;
  while (index < unitEnd) {
    let count = 1;
    while (index + count < unitEnd && itemsEqual(items[index + count], items[index])) count++;
    const cols: number[] = [];
    for (let repeat = 0; repeat < plan.repeats; repeat++) {
      const base = plan.before + repeat * plan.period;
      for (let step = 0; step < count; step++) cols.push(...items[base + index - plan.before + step].cols);
    }
    tokens.push(tokenFor(items[index], count, multi, cols, true));
    index += count;
  }
  const tailStart = plan.before + plan.period * plan.repeats;
  tokens.push(...runTokens(items, tailStart, items.length, multi, false));
  return tokens;
}

function runTokens(items: WorkedItem[], from: number, to: number, multi: boolean, inRepeat: boolean): LineToken[] {
  const tokens: LineToken[] = [];
  let index = from;
  while (index < to) {
    let count = 1;
    while (index + count < to && itemsEqual(items[index + count], items[index])) count++;
    const cols: number[] = [];
    for (let step = 0; step < count; step++) cols.push(...items[index + step].cols);
    tokens.push(tokenFor(items[index], count, multi, cols, inRepeat));
    index += count;
  }
  return tokens;
}

function tokenFor(item: WorkedItem, count: number, multi: boolean, cols: number[], inRepeat: boolean): LineToken {
  return { text: formatRun(item, count, multi), cols: dedupe(cols), inRepeat };
}

function dedupe(cols: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const col of cols) {
    if (!seen.has(col)) {
      seen.add(col);
      out.push(col);
    }
  }
  return out;
}
