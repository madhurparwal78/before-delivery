// Form fields with inline errors, dialogs that fade and return focus, and agency-time labels.
import { agencyTime, cardDate } from "../shared/time.js";
import { h, prefersReducedMotion, uid } from "./dom.js";

export function when(start: string, end: string): string {
  const s = new Date(start);
  return `${cardDate(s)} ${agencyTime(s)}–${agencyTime(new Date(end))}`;
}

export interface Field {
  wrap: HTMLDivElement;
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  error: HTMLParagraphElement;
}

export function field(label: string, control: Field["control"], hint?: string): Field {
  const id = uid("f");
  control.id = id;
  const error = h("p", { class: "field-error", id: `${id}-error` });
  const hintEl = hint ? h("p", { class: "field-hint", id: `${id}-hint` }, hint) : null;
  control.setAttribute("aria-describedby", [hintEl ? `${id}-hint` : "", `${id}-error`].filter(Boolean).join(" "));
  const wrap = h("div", { class: "field" }, h("label", { for: id }, label), control, hintEl, error);
  return { wrap, control, error };
}

export function textInput(attrs: Record<string, string> = {}): HTMLInputElement {
  return h("input", { type: "text", autocomplete: "off", ...attrs });
}

export function select(options: [string, string][], placeholder: string): HTMLSelectElement {
  return h("select", {}, h("option", { value: "" }, placeholder), ...options.map(([value, label]) => h("option", { value }, label)));
}

/** Shows each server field message under its field; clears the rest. */
export function showErrors(fields: Record<string, Field>, errors: Record<string, string> = {}): void {
  for (const [name, f] of Object.entries(fields)) {
    const message = errors[name] ?? "";
    f.error.textContent = message;
    if (message) f.control.setAttribute("aria-invalid", "true");
    else f.control.removeAttribute("aria-invalid");
  }
}

export function button(label: string, attrs: Record<string, string> = {}, kind: "primary" | "quiet" = "primary"): HTMLButtonElement {
  return h("button", { type: "button", class: `button ${kind}`, ...attrs }, label);
}

/** A modal dialog named by its heading; Escape closes it and focus returns to the opener. */
export function dialog(title: string): { el: HTMLDialogElement; body: HTMLDivElement; open: (opener: HTMLElement) => void; close: () => void } {
  const titleId = uid("dialog-title");
  const body = h("div", { class: "dialog-body" });
  const el = h("dialog", { class: "dialog", "aria-labelledby": titleId }, h("h2", { id: titleId }, title), body);
  let opener: HTMLElement | null = null;
  const finish = (): void => {
    el.close();
    el.remove();
    opener?.focus();
  };
  const close = (): void => {
    if (!el.open) return;
    if (prefersReducedMotion()) finish();
    else el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: "ease-out" }).finished.then(finish, finish);
  };
  el.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  const open = (from: HTMLElement): void => {
    opener = from;
    document.body.append(el);
    el.showModal();
    if (!prefersReducedMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  };
  return { el, body, open, close };
}

export function emptyNote(text: string): HTMLParagraphElement {
  return h("p", { class: "empty" }, text);
}
