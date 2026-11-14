import type { Change, Definition, Page, Question } from "./types.js";

export const PAGE_FIELDS = ["title", "show_rule", "jumps"] as const;
export const FORM_FIELDS = ["title", "intro", "checks"] as const;

export type Target =
  | { kind: "form" }
  | { kind: "page"; page: Page }
  | { kind: "question"; page: Page; question: Question };

export function findQuestion(def: Definition, key: string): { page: Page; question: Question } | null {
  for (const page of def.pages) {
    const question = page.questions.find((q) => q.key === key);
    if (question) return { page, question };
  }
  return null;
}

export function allQuestions(def: Definition): Question[] {
  return def.pages.flatMap((p) => p.questions);
}

export function resolveTarget(def: Definition, key: string, field: string): Target | null {
  if (key === "form") return { kind: "form" };
  const found = findQuestion(def, key);
  if (found && field !== "title" && field !== "jumps") return { kind: "question", ...found };
  const page = def.pages.find((p) => p.key === key);
  if (page && (PAGE_FIELDS as readonly string[]).includes(field)) return { kind: "page", page };
  return null;
}

function setField(obj: object, field: string, value: unknown): void {
  const rec = obj as Record<string, unknown>;
  if (value === null || value === undefined) delete rec[field];
  else rec[field] = value;
}

/** Applies a change in place. Returns false when the change names something that no longer exists. */
export function applyChange(def: Definition, change: Change): boolean {
  switch (change.op) {
    case "set": {
      const target = resolveTarget(def, change.key, change.field);
      if (!target) return false;
      if (target.kind === "form") setField(def, change.field, change.value);
      else if (target.kind === "page") setField(target.page, change.field, change.value);
      else setField(target.question, change.field, change.value);
      return true;
    }
    case "add_question": {
      const page = def.pages.find((p) => p.key === change.page);
      if (!page) return false;
      page.questions.push(structuredClone(change.question));
      return true;
    }
    case "remove_question": {
      const found = findQuestion(def, change.key);
      if (!found) return false;
      found.page.questions = found.page.questions.filter((q) => q.key !== change.key);
      return true;
    }
    case "move_question": {
      const found = findQuestion(def, change.key);
      if (!found) return false;
      const list = found.page.questions;
      const from = list.indexOf(found.question);
      const to = Math.max(0, Math.min(list.length - 1, change.position - 1));
      list.splice(from, 1);
      list.splice(to, 0, found.question);
      return true;
    }
    case "add_page": {
      const at = Math.max(0, Math.min(def.pages.length, change.position - 1));
      def.pages.splice(at, 0, structuredClone(change.page));
      return true;
    }
    case "remove_page": {
      const index = def.pages.findIndex((p) => p.key === change.key);
      if (index < 0) return false;
      def.pages.splice(index, 1);
      return true;
    }
  }
}
