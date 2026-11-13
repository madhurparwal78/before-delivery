import { ApiFailure } from "./api.js";

export type Child = Node | string | null | undefined | false;

/** Small element builder keeping names close to the domain words. */
export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (name === "class") {
      element.className = String(value);
    } else if (name === "text") {
      element.textContent = String(value);
    } else if (name.startsWith("on") && typeof value === "function") {
      element.addEventListener(name.slice(2), value as EventListener);
    } else if (value === true) {
      element.setAttribute(name, "");
    } else {
      element.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function clear(element: HTMLElement): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

export function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

const ICONS: Record<string, string> = {
  "triangle-up": '<path d="m5 14 7-8 7 8" />',
  "triangle-hollow": '<path d="m5 14 7-8 7 8" />',
  star: '<path d="M11.525 2.485a.55.55 0 0 1 .95 0l2.27 4.6 5.09.74a.55.55 0 0 1 .3.94l-3.68 3.59.87 5.07a.55.55 0 0 1-.8.58l-4.55-2.4-4.55 2.4a.55.55 0 0 1-.8-.58l.87-5.07-3.68-3.59a.55.55 0 0 1 .3-.94l5.09-.74z" />',
  circle: '<circle cx="12" cy="12" r="9" />',
  cross: '<path d="M18 6 6 18M6 6l12 12" />',
};

/** Status glyphs are hidden from assistive technology; the label carries the meaning. */
export function marker(kind: "above" | "below" | "winner" | "finalist" | "mention" | "disqualified", label: string): HTMLElement {
  let svg: string;
  let cls: string;
  switch (kind) {
    case "above":
      svg = wrapIcon(ICONS["triangle-up"], true);
      cls = "marker-cut";
      break;
    case "below":
      svg = wrapIcon(ICONS["triangle-hollow"], false);
      cls = "marker-below";
      break;
    case "winner":
      svg = wrapIcon(ICONS.star, true);
      cls = "marker-winner";
      break;
    case "finalist":
      svg = wrapIcon(ICONS.star, false);
      cls = "marker-finalist";
      break;
    case "mention":
      svg = wrapIcon(ICONS.circle, false);
      cls = "marker-mention";
      break;
    default:
      svg = wrapIcon(ICONS.cross, false);
      cls = "marker-disqualified";
      break;
  }
  const holder = h("span", { class: `status-marker ${cls}` });
  holder.innerHTML = svg;
  holder.append(label);
  return holder;
}

function wrapIcon(path: string, filled: boolean): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" ${filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${path}</svg>`;
}

let statusTimer = 0;

export function deskStatus(text: string): void {
  const element = document.getElementById("desk-status");
  if (!element) {
    return;
  }
  window.clearTimeout(statusTimer);
  element.textContent = text;
}

export function deskStatusAuto(text: string): void {
  deskStatus(text);
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    deskStatus("");
  }, 8000);
}

export function deskError(text: string): void {
  const element = document.getElementById("desk-error");
  if (!element) {
    return;
  }
  element.textContent = text;
}

export function deskErrorFrom(error: unknown): string {
  if (error instanceof ApiFailure) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong at the desk.";
}

/** Extracts a field error for tying it under the field. */
export function fieldError(error: unknown, field: string): string | null {
  if (error instanceof ApiFailure && error.errors && error.errors[field]) {
    return error.errors[field];
  }
  return null;
}

export function showFieldErrors(form: HTMLFormElement, error: unknown): void {
  for (const note of form.querySelectorAll<HTMLElement>(".field-error")) {
    note.remove();
  }
  if (!(error instanceof ApiFailure) || !error.errors) {
    return;
  }
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(error.errors)) {
    const input =
      form.querySelector<HTMLElement>(`[name="${name}"]`) ??
      form.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (!input) {
      continue;
    }
    const note = h("span", { class: "field-error", text: message });
    if (input.parentElement) {
      input.parentElement.append(note);
    }
    if (!first) {
      first = input;
    }
  }
  if (first) {
    first.focus();
  }
}

/** Pending copy on the submitting button, disabled while the request runs. */
export async function withPending<T>(button: HTMLButtonElement, pendingText: string, fn: () => Promise<T>): Promise<T> {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = pendingText;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original ?? "";
  }
}

export interface DialogOptions {
  title: string;
  body?: string;
  fields?: { name: string; label: string; type?: string }[];
  actions: { label: string; kind?: "primary" | "danger" | "plain"; value: string }[];
  safeValue: string;
  onChoose: (value: string, fields: Record<string, string>) => void;
}

/** Traps focus inside a dialog; Escape or the safe button closes it. */
export function openDialog(options: DialogOptions): void {
  const existing = document.querySelector<HTMLDialogElement>("dialog[data-cutline]");
  if (existing) {
    existing.close();
    existing.remove();
  }
  const dialog = document.createElement("dialog");
  dialog.setAttribute("data-cutline", "");
  const body = h("div", { class: "dialog-body" });
  body.append(h("h2", { text: options.title }));
  if (options.body) {
    body.append(h("p", { text: options.body }));
  }
  const fieldValues: Record<string, string> = {};
  const firstField = options.fields?.[0];
  for (const field of options.fields ?? []) {
    const input = h("input", { type: field.type ?? "text", name: field.name, id: `dialog-${field.name}` });
    input.addEventListener("input", () => {
      fieldValues[field.name] = (input as HTMLInputElement).value;
    });
    const wrap = h("label", { class: "field" }, h("span", { text: field.label }), input);
    body.append(wrap);
  }
  const actions = h("div", { class: "dialog-actions" });
  for (const action of options.actions) {
    actions.append(
      h("button", {
        class: action.kind === "primary" ? "primary" : action.kind === "danger" ? "danger" : "",
        text: action.label,
        type: "button",
        onclick: () => close(action.value),
      }),
    );
  }
  body.append(actions);
  dialog.append(body);
  document.body.append(dialog);

  let lastFocused: HTMLElement | null = document.activeElement as HTMLElement;
  let chose = false;

  function close(value: string): void {
    if (chose) {
      return;
    }
    chose = true;
    const finish = () => {
      dialog.remove();
      document.removeEventListener("keydown", keydown, true);
      if (lastFocused && document.contains(lastFocused)) {
        lastFocused.focus();
      }
      if (value) {
        options.onChoose(value, fieldValues);
      }
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
    } else {
      dialog.classList.add("closing");
      dialog.addEventListener("animationend", finish, { once: true });
      window.setTimeout(finish, 250);
    }
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close("");
      return;
    }
    if (event.key === "Tab") {
      const focusables = dialog.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href]");
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener("keydown", keydown, true);
  dialog.addEventListener("close", () => {
    if (!chose) {
      close("");
    }
  });
  dialog.showModal();
  const safe = options.actions.find((a) => a.value === options.safeValue);
  if (firstField) {
    dialog.querySelector<HTMLElement>(`#dialog-${firstField.name}`)?.focus();
  } else if (safe) {
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((b) => b.textContent === safe.label)?.focus();
  } else {
    dialog.querySelector<HTMLElement>("button")?.focus();
  }
  lastFocused = (document.activeElement as HTMLElement) ?? null;
}
