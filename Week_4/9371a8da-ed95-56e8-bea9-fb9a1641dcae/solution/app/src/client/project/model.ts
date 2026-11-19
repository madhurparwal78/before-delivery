import type { ApiResult } from "../api.ts";
import type { CitationReport, ProjectFile, Review, Role, Suggestion, TextFile, Thread } from "../../shared/api.ts";
import type { Named } from "./Margin.tsx";

/** The file open in the source, with the stored text it was loaded from. */
export interface OpenDoc {
  file: ProjectFile;
  stored: string;
  /** The stored text as the text field shows it (line breaks as LF). */
  view: string;
  revision: number;
}

export type ReviewData = Review<Named>;
export type NamedSuggestion = Suggestion<Named>;
export type NamedThread = Thread<Named>;

export interface Selection {
  start: number;
  end: number;
}

export type DialogState =
  | { kind: "suggest"; selection: Selection; quote: string }
  | { kind: "comment"; selection: Selection; quote: string }
  | { kind: "new-file" }
  | { kind: "upload" }
  | { kind: "delete"; file: ProjectFile }
  | { kind: "stale"; unsaved: string; current: TextFile }
  | { kind: "history" }
  | { kind: "people" }
  | { kind: "citations" }
  | { kind: "submission" }
  | { kind: "files" };

/** What every dialog of the project view may do. */
export interface ViewContext {
  base: string;
  role: Role;
  title: string;
  projectRevision: number;
  citations: CitationReport | null;
  review: ReviewData | null;
  say: (text: string) => void;
  sayStorage: (text: string) => void;
  /** Runs an own action: handles signed-out, forbidden and not-found answers, then refreshes. Null when no answer arrived. */
  act: <T>(run: () => Promise<ApiResult<T>>) => Promise<ApiResult<T> | null>;
}

export const SOMETHING_WRONG = "Something went wrong. Try again.";
export const STORAGE_DOWN = "Figure storage unavailable. Text editing still works; try again shortly.";
export const UNSTORABLE_FIELD = "This text contains a character that cannot be stored.";
export const PATH_RULE = "Use letters, digits, dots, hyphens and underscores, separated by slashes.";

export function canEdit(role: Role | null): boolean {
  return role === "owner" || role === "editor";
}

export function canSuggest(role: Role | null): boolean {
  return role === "owner" || role === "editor" || role === "reviewer";
}

export function citationCopy(report: CitationReport | null): string {
  if (!report) return "Checking citations…";
  const count = report.undefined.length;
  if (count === 0) return "No undefined citations";
  return count === 1 ? "1 undefined citation" : `${count} undefined citations`;
}

export function openCount(count: number): string {
  return count === 1 ? "1 open remains" : `${count} open remain`;
}
