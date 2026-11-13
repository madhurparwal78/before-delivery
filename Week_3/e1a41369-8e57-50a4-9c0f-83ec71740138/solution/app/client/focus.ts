let pending: string | null = null;

/** Focus the element matching `selector` once it exists; a later key press or pointer press cancels it. */
export function focusWhenPresent(selector: string): void {
  pending = selector;
  applyPendingFocus();
}

export function applyPendingFocus(): void {
  if (!pending) return;
  const target = document.querySelector<HTMLElement>(pending);
  if (!target) return;
  pending = null;
  target.focus();
}

for (const kind of ["keydown", "pointerdown"]) window.addEventListener(kind, () => (pending = null), { capture: true });

export const rowSelector = (taskId: string): string => `[data-task-id="${taskId}"]`;
export const firstRowSelector = (list: string): string => `[data-list="${list}"] [data-task-id], [data-list="${list}"]:not(:has([data-task-id]))`;
