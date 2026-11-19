import type { FocusEvent } from "react";

/** The id (from data-focus-id) of the control that took focus, for screens that bring focus back after a reload. */
export function focusIdOf(event: FocusEvent<HTMLElement>): string | null {
  const target = event.target;
  return target instanceof HTMLElement ? (target.closest<HTMLElement>("[data-focus-id]")?.dataset.focusId ?? null) : null;
}

export function focusById(root: ParentNode, id: string): boolean {
  const target = [...root.querySelectorAll<HTMLElement>("[data-focus-id]")].find((element) => element.dataset.focusId === id);
  target?.focus({ preventScroll: true });
  return target !== undefined;
}
