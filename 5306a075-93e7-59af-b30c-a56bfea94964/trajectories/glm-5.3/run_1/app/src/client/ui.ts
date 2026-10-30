import type { Child } from "./dom.js";
import { h } from "./dom.js";
import type { ApiError } from "../shared/types.js";
import { ApiFailure } from "./api.js";

/** The shell's live regions and the page alert. */
export interface Feedback {
  saveStatus(text: string): void;
  evidence(text: string): void;
  board(text: string): void;
  alert(text: string): void;
  clearAlert(): void;
}

export let feedback: Feedback | null = null;

export function setFeedback(value: Feedback): void {
  feedback = value;
}

/** True when the operating system asks for less motion (DP-42). */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const TEMPO = {
  quick: 170,
  medium: 280,
  slow: 420,
};

/** Count a figure from its old value to its new value (DP-06). */
export function countUp(
  element: HTMLElement,
  from: number,
  to: number,
  durationMs: number,
): void {
  if (prefersReducedMotion() || from === to) {
    element.textContent = String(to);
    return;
  }
  const start = performance.now();
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - (1 - t) * (1 - t);
    element.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(tick);
    else element.textContent = String(to);
  };
  requestAnimationFrame(tick);
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    candidate: "Candidate",
    planned: "Planned",
    in_progress: "In progress",
    released: "Released",
    archived: "Archived",
    open: "Open",
    frozen: "Frozen",
    shipped: "Shipped",
    unprocessed: "Unprocessed",
    snoozed: "Snoozed",
    processed: "Processed",
    nice_to_have: "Nice to have",
    important: "Important",
    critical: "Critical",
    support_ticket: "Support ticket",
    sales_call: "Sales call",
    email: "Email",
    csv_import: "CSV import",
  };
  return labels[status] ?? status;
}

/** Extract an error message for the page alert. */
export function alertFor(err: unknown): string {
  if (err instanceof ApiFailure) {
    const failure = err.error as ApiError & { error: { message: string; current?: unknown } };
    return failure.error.message;
  }
  return "Something went wrong on our side. Nothing was saved.";
}

/**
 * Open a dialog: focus moves to its first field, Tab cycles inside it,
 * Escape closes it and focus returns to the control that opened it.
 */
export function openDialog(
  build: (close: () => void) => Element | Promise<Element>,
  opener: HTMLElement | null,
): void {
  const previous = opener ?? (document.activeElement as HTMLElement | null);
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  const close = (): void => {
    dialog.close();
  };
  dialog.addEventListener("close", () => {
    dialog.remove();
    previous?.focus();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  const focusFirst = (): void => {
    const firstField = dialog.querySelector<HTMLElement>("input, select, textarea, button");
    firstField?.focus();
  };
  void Promise.resolve(build(close)).then((content) => {
    dialog.appendChild(content);
    focusFirst();
  });
}

/** A row of dialog action buttons. */
export function dialogActions(children: Child[]): HTMLElement {
  return h("div", { class: "dialog-actions" }, children) as HTMLElement;
}

/** Render an error under a field, linked to it as its description. */
export function fieldError(message: string | null): HTMLElement | null {
  if (message === null) return null;
  return h("span", { class: "field-error", role: "alert" }, message);
}
