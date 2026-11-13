/**
 * The two live regions live in index.html, so they exist from the first byte and are never inserted or removed.
 * Each announcement empties its region and sets the new text in a later task, so the same message twice in a row is
 * announced twice. The hop is a MessageChannel task, not a timer: it needs no animation frame or clock tick.
 */
const channel = new MessageChannel();
const queue: (() => void)[] = [];
channel.port1.onmessage = () => queue.shift()?.();

function nextTask(work: () => void): void {
  queue.push(work);
  channel.port2.postMessage(0);
}

const region = (id: "action-status" | "action-error"): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`#${id} is missing from index.html`);
  return element;
};

const generation = { status: 0, error: 0 };

function announce(kind: "status" | "error", text: string): void {
  const element = region(kind === "status" ? "action-status" : "action-error");
  generation[kind] += 1;
  const mine = generation[kind];
  element.textContent = "";
  if (text === "") return;
  nextTask(() => {
    if (generation[kind] === mine) element.textContent = text;
  });
}

/** Pending and success copy. An error empties it, so no pending copy lingers. */
export const announceStatus = (text: string): void => announce("status", text);

/** Error, conflict and outage copy. */
export const announceError = (text: string): void => announce("error", text);

/** Starting an action empties the error region. */
export const clearError = (): void => announce("error", "");
