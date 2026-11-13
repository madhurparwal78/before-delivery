// Quick actions in comments, durations, weights and the scoped-label change rules (see "Issues, labels and planning").
import { scopedKey } from "../../shared/labels.ts";

const QUICK_ACTION_NAMES = [
  "assign",
  "unassign",
  "label",
  "unlabel",
  "milestone",
  "weight",
  "estimate",
  "spend",
  "due",
  "close",
  "reopen",
  "confidential",
  "relate",
  "promote",
  "title",
] as const;

type QuickActionName = (typeof QUICK_ACTION_NAMES)[number];

export interface QuickAction {
  readonly name: QuickActionName;
  readonly args: string;
  readonly raw: string;
}

interface ParsedComment {
  readonly text: string;
  readonly actions: readonly QuickAction[];
}

const ACTION_LINE = /^\/([a-z]+)(?:[ \t]+(.*))?$/u;

function isActionName(name: string): name is QuickActionName {
  return QUICK_ACTION_NAMES.some((known) => known === name);
}

export function parseCommentBody(body: string): ParsedComment {
  const kept: string[] = [];
  const actions: QuickAction[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const match = ACTION_LINE.exec(line.trimEnd());
    const name = match?.[1];
    if (match !== null && name !== undefined && isActionName(name)) {
      actions.push({ name, args: (match[2] ?? "").trim(), raw: line });
    } else {
      kept.push(rawLine);
    }
  }
  const text = kept.join("\n").replace(/^(?:[ \t\r]*\n)+/u, "").trimEnd();
  return { text, actions };
}

/** Names after a `~`, `%` or `@` prefix; a name with spaces is quoted, as in `~"needs review"`. */
export function parseNames(args: string, prefix: "~" | "%" | "@"): string[] {
  const names: string[] = [];
  const token = /(?:[~%@])?"([^"]*)"|(\S+)/gu;
  for (const match of args.matchAll(token)) {
    const quoted = match[1];
    const bare = match[2];
    const name = quoted ?? (bare !== undefined && bare.startsWith(prefix) ? bare.slice(1) : (bare ?? ""));
    if (name !== "") names.push(name);
  }
  return names;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 8 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 5 * MINUTES_PER_DAY;
const MINUTES_PER_MONTH = 4 * MINUTES_PER_WEEK;

const UNIT_MINUTES: Readonly<Record<string, number>> = {
  mo: MINUTES_PER_MONTH,
  w: MINUTES_PER_WEEK,
  d: MINUTES_PER_DAY,
  h: MINUTES_PER_HOUR,
  m: 1,
};

const DURATION = /^(?:\d+(?:mo|w|d|h|m)[ \t]*)+$/u;

/** Minutes for text like `2d 3h`, or null when it is not a duration. */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  if (!DURATION.test(trimmed)) return null;
  let total = 0;
  for (const part of trimmed.matchAll(/(\d+)(mo|w|d|h|m)/gu)) {
    total += Number(part[1]) * (UNIT_MINUTES[part[2] ?? ""] ?? 0);
  }
  return Number.isSafeInteger(total) ? total : null;
}

export function formatDuration(minutes: number): string {
  if (minutes === 0) return "0m";
  const parts: string[] = [];
  let rest = minutes;
  for (const unit of ["mo", "w", "d", "h", "m"]) {
    const size = UNIT_MINUTES[unit] ?? 1;
    const amount = Math.floor(rest / size);
    rest -= amount * size;
    if (amount > 0) parts.push(`${amount}${unit}`);
  }
  return parts.join(" ");
}

export const WEIGHT_MESSAGE = "Weight must be 0 to 100.";

export function isValidWeight(weight: number): boolean {
  return Number.isInteger(weight) && weight >= 0 && weight <= 100;
}

/** The weight in `text`, or null when it is not an integer from 0 to 100. */
export function parseWeight(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/u.test(trimmed)) return null;
  const weight = Number(trimmed);
  return isValidWeight(weight) ? weight : null;
}

interface LabelChange {
  readonly labels: string[];
  readonly notes: string[];
}

export function labelChange(current: readonly string[], add: readonly string[], remove: readonly string[]): LabelChange {
  let labels = current.filter((label) => !remove.includes(label));
  for (const label of new Set(add)) {
    const key = scopedKey(label);
    if (key !== null) labels = labels.filter((other) => other === label || scopedKey(other) !== key);
    if (!labels.includes(label)) labels.push(label);
  }
  const added = labels.filter((label) => !current.includes(label));
  const removed = current.filter((label) => !labels.includes(label));
  const replaced: string[] = [];
  const plainAdded: string[] = [];
  const consumed = new Set<string>();
  for (const label of added) {
    const key = scopedKey(label);
    const olds = key === null ? [] : removed.filter((old) => scopedKey(old) === key);
    for (const old of olds) {
      replaced.push(`Replaced ~${old} with ~${label}.`);
      consumed.add(old);
    }
    if (olds.length === 0) plainAdded.push(label);
  }
  const plainRemoved = removed.filter((label) => !consumed.has(label));
  const notes = [...replaced];
  if (plainAdded.length > 0) notes.push(`Added ${plainAdded.map((label) => `~${label}`).join(" ")}.`);
  if (plainRemoved.length > 0) notes.push(`Removed ${plainRemoved.map((label) => `~${label}`).join(" ")}.`);
  return { labels, notes };
}
