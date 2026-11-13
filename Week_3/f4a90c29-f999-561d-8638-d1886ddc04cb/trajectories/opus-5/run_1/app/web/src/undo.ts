// Undo puts back exactly what a move, resize or trash altered, for ten
// seconds, by button or by Z.

import { api } from "./api";
import { el, on } from "./dom";
import { announce, changed } from "./state";

export type UndoStep = {
  title: string;
  run: () => Promise<void>;
};

let current: UndoStep | null = null;
let timer: number | null = null;

export function offerUndo(step: UndoStep): void {
  current = step;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    current = null;
    changed();
  }, 10000);
  changed();
}

export function clearUndo(): void {
  current = null;
  if (timer !== null) window.clearTimeout(timer);
  changed();
}

export async function runUndo(): Promise<void> {
  const step = current;
  if (!step) return;
  current = null;
  changed();
  announce(`Saving ${step.title}...`);
  try {
    await step.run();
    announce(`Undid the last change to ${step.title}.`);
  } catch (error) {
    announce((error as Error).message);
  }
}

export function undoButton(): HTMLElement | null {
  if (!current) return null;
  const button = el("button", { type: "button", class: "undo", text: "Undo" });
  on(button, "click", () => void runUndo());
  return button;
}

/** restoreTimes writes an event's times back as they were. */
export function restoreTimes(
  eventID: string,
  version: number,
  startLocal: string,
  endLocal: string,
  scope: string | null,
  occurrenceID: string | null,
): () => Promise<void> {
  return async () => {
    const body: Record<string, unknown> = { start_local: startLocal, end_local: endLocal };
    if (scope) {
      body.scope = scope;
      body.occurrence_id = occurrenceID;
    }
    await api.patchEvent(eventID, version, body);
  };
}

export function restoreFromTrash(trashID: string): () => Promise<void> {
  return async () => {
    await api.restore(trashID);
  };
}
