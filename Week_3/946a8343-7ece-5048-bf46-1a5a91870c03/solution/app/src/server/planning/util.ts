// Small helpers for reading request bodies and shaping the notes every planning route returns.
import type { Ctx } from "../http.ts";
import { iso } from "../clock.ts";
import type { FieldErrors } from "../errors.ts";
import { isDate } from "./burndown.ts";
import { isRecord } from "../json.ts";

export type Body = Readonly<Record<string, unknown>>;

export function bodyOf(ctx: Ctx): Body {
  const value = ctx.body;
  return isRecord(value) ? value : {};
}

export function has(body: Body, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

export function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    items.push(item);
  }
  return items;
}

const TITLE_MAX = 255;

export function titleProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "Title can't be blank.";
  if (Array.from(value.trim()).length > TITLE_MAX) return "Title is too long (255 characters at most).";
  return null;
}

export interface NoteRow {
  readonly id: number;
  readonly author: string;
  readonly body: string;
  readonly system: boolean;
  readonly created_at: number;
}

export interface NoteView {
  readonly id: number;
  readonly author: string;
  readonly body: string;
  readonly system: boolean;
  readonly pending: false;
  readonly thread_id: null;
  readonly created_at: string;
}

export function noteView(row: NoteRow): NoteView {
  return { id: row.id, author: row.author, body: row.body, system: row.system, pending: false, thread_id: null, created_at: iso(row.created_at) };
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The path of the group a project lives in. */
export function groupPathOfProject(projectPath: string): string {
  return projectPath.slice(0, projectPath.lastIndexOf("/"));
}

/** A `YYYY-MM-DD` field of a body; a bad one adds its error and reads as an empty string. */
export function dateField(errors: FieldErrors, body: Body, key: string, message: string): string {
  const value = body[key];
  if (isDate(value)) return value;
  errors.add(key, message);
  return "";
}
