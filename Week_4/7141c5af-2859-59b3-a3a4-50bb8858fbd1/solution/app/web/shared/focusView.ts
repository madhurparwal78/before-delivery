/**
 * Calls `bring` for each control that takes focus. A press's focus arrives between its mousedown and its
 * mouseup, and scrolling there would pull the press off the control, so a pressed control waits for its click.
 */
export function onFocusTaken(bring: (node: HTMLElement) => void): void {
  let pressing = false;
  let waiting: HTMLElement | null = null;
  document.addEventListener("mousedown", () => (pressing = true), true);
  document.addEventListener("keydown", () => {
    pressing = false;
    waiting = null;
  }, true);
  document.addEventListener("click", () => {
    pressing = false;
    if (waiting && waiting === document.activeElement) bring(waiting);
    waiting = null;
  });
  document.addEventListener("focusin", (event) => {
    const node = event.target as HTMLElement;
    if (pressing) waiting = node;
    else bring(node);
  });
}
