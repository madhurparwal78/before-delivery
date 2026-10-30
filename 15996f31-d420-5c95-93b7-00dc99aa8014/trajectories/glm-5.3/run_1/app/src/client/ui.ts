/** DOM helpers, live regions, dialog management and feedback announcements. */

export type Child = Node | string | null | undefined | false;

type ElementOf<T extends string> =
  T extends "input" ? HTMLInputElement
  : T extends "select" ? HTMLSelectElement
  : T extends "button" ? HTMLButtonElement
  : T extends "textarea" ? HTMLTextAreaElement
  : T extends "a" ? HTMLAnchorElement
  : T extends "dialog" ? HTMLDialogElement
  : T extends "img" ? HTMLImageElement
  : T extends "form" ? HTMLFormElement
  : T extends "table" ? HTMLTableElement
  : T extends "option" ? HTMLOptionElement
  : T extends "ol" ? HTMLOListElement
  : HTMLElement;

export function h<T extends string>(tag: T, attrs: Record<string, unknown> | null = {}, ...children: Child[]): ElementOf<T> {
  const element = document.createElement(tag) as ElementOf<T>;
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") element.className = String(value);
    else if (key === "text") element.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2), value as EventListener);
    } else if (value === true) element.setAttribute(key, "");
    else element.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function clear(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function liveElement(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** Pending and success copy goes to status "Desk updates". */
export function announceUpdate(message: string): void {
  const region = liveElement("desk-updates");
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 30);
}

/** Refusals and outages go to alert "Desk problems". */
export function announceProblem(message: string): void {
  const region = liveElement("desk-problems");
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 30);
}

/** Strength readout announcements after every accepted change. */
export function announceStrength(message: string): void {
  const region = liveElement("strength-readout");
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 30);
}

export interface ChangeNote {
  blockName: string;
  oldAverage: string;
  newAverage: string;
  oldTier: string;
  newTier: string;
}

/** Reduced motion: each accepted change adds a one-line note to the log. */
export function addStrengthChangeNote(note: ChangeNote): void {
  const log = liveElement("strength-changes") as HTMLOListElement;
  log.hidden = false;
  const tierChanged = note.oldTier !== note.newTier;
  const line = note.oldAverage === "no samples"
    ? `${note.blockName}: no samples → ${note.newAverage} frames, now ${note.newTier}`
    : note.newAverage === "no samples"
      ? `${note.blockName}: ${note.oldAverage} → no samples, now ${note.newTier}`
      : `${note.blockName}: ${note.oldAverage} → ${note.newAverage} frames, ${tierChanged ? `now ${note.newTier}` : `still ${note.newTier}`}`;
  const item = document.createElement("li");
  item.textContent = line;
  log.append(item);
  while (log.children.length > 20) log.removeChild(log.firstChild!);
}

/** A button showing progress dots (or the static word when motion is reduced). */
export function busyButton(button: HTMLButtonElement): () => void {
  const label = button.textContent ?? "";
  button.disabled = true;
  if (reducedMotion()) {
    button.textContent = `${label} Working…`;
  } else {
    const dots = h("span", { class: "busy-dots", "aria-hidden": "true" },
      h("span"), h("span"), h("span"));
    button.append(dots);
  }
  return () => {
    button.disabled = false;
    button.textContent = label;
  };
}

export interface DialogSpec {
  label: string;
  fields: HTMLElement[];
  submitLabel: string;
  onSubmit: (getField: (name: string) => HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) => Promise<boolean>;
  /** Extra message shown above the fields (e.g. refusal copy). */
  notice?: () => HTMLElement | null;
}

/**
 * A dialog that holds focus, closes on Escape, and returns focus to its opener.
 */
export function openDialog(spec: {
  label: string;
  content: HTMLElement[];
  opener?: HTMLElement;
}): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", spec.label);
  for (const node of spec.content) dialog.append(node);
  dialog.addEventListener("close", () => {
    dialog.remove();
    spec.opener?.focus();
  });
  if (!dialog.querySelector(".dialog-close")) {
    const actions = dialog.querySelector(".dialog-actions");
    const close = h("button", { type: "button", text: "Close", class: "dialog-close" });
    close.addEventListener("click", () => dialog.close());
    actions?.prepend(close);
  }
  document.body.append(dialog);
  dialog.showModal();
  const firstField = dialog.querySelector<HTMLElement>("input, select, textarea");
  firstField?.focus();
  return dialog;
}

/** Renders the "There is a problem" summary with one link per field message. */
export function showFieldErrors(container: HTMLElement, fields: Record<string, string>): void {
  for (const element of container.querySelectorAll<HTMLElement>("[data-error-for]")) {
    element.remove();
  }
  if (Object.keys(fields).length === 0) return;
  const summary = h("div", { class: "error-summary", role: "group" });
  summary.append(h("h3", { text: "There is a problem" }));
  const list = h("ul");
  for (const [field, message] of Object.entries(fields)) {
    const label = fieldLabel(container, field);
    list.append(h("li", {}, h("a", {
      href: "#",
      text: message,
      onclick: (event: Event) => {
        event.preventDefault();
        container.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
      },
    })));
    const fieldElement = container.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (fieldElement) {
      fieldElement.setAttribute("aria-invalid", "true");
      fieldElement.classList.add("invalid");
      const messageElement = h("p", { class: "message", "data-error-for": field, text: message });
      fieldElement.insertAdjacentElement("afterend", messageElement);
    }
    void label;
  }
  summary.append(list);
  const form = container.closest("form") ?? container;
  form.querySelector(".error-summary")?.remove();
  form.prepend(summary);
  summary.querySelector<HTMLElement>("a")?.focus();
}

function fieldLabel(container: HTMLElement, field: string): string {
  return field;
}

export function clearFieldErrors(container: HTMLElement): void {
  container.querySelector(".error-summary")?.remove();
  for (const element of container.querySelectorAll<HTMLElement>("[data-error-for]")) element.remove();
  for (const element of container.querySelectorAll<HTMLElement>("[aria-invalid]")) {
    element.removeAttribute("aria-invalid");
    element.classList.remove("invalid");
  }
}

/** Standard problem copy for an API failure. */
export function problemMessage(error: unknown, context: { ref?: string; status?: string }): string {
  const problem = error instanceof Error && "status" in error
    ? error as unknown as { status: number; code: string; message: string; fields: Record<string, string>; remaining?: number }
    : null;
  if (!problem) {
    return "Bloom Desk can't reach its server. Check your connection and try again.";
  }
  if (problem.status === 401) {
    return "Your session has ended. Sign in again.";
  }
  if (problem.status === 404) {
    return "That record isn't available to you.";
  }
  if (problem.code === "idempotency_key_reused") {
    return "That request was already sent with different details. Reload and try again.";
  }
  if (problem.code === "invalid_transition" && context.ref) {
    return `That can't be done while ${context.ref} is ${context.status ?? "not ready"}.`;
  }
  if (problem.status >= 500) {
    return "Something went wrong on our side. Try again in a minute.";
  }
  return problem.message || "Something went wrong. Try again.";
}
