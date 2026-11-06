// Labelled fields with their error line underneath, and the mapping from an `invalid` answer to them.

import { h, uid } from "./dom.ts";

interface Field {
  wrap: HTMLElement;
  error: HTMLElement;
  control: HTMLElement;
}

/** A label, its control, an optional hint and the error line, tied together with aria-describedby. */
export function field(label: string, control: HTMLInputElement | HTMLSelectElement, hint?: string): Field {
  const id = control.id || uid("field");
  control.id = id;
  const error = h("p", { class: "field-error", id: uid("error"), hidden: true });
  const hintLine = hint ? h("p", { class: "field-hint", id: uid("hint") }, hint) : null;
  control.setAttribute("aria-describedby", [hintLine?.id, error.id].filter(Boolean).join(" "));
  const wrap = h("div", { class: "field" }, h("label", { for: id }, label), control, hintLine, error);
  return { wrap, error, control };
}

export function showError(target: { error: HTMLElement; control: HTMLElement }, message: string | undefined): void {
  target.error.hidden = !message;
  target.error.textContent = message ?? "";
  if (message) target.control.setAttribute("aria-invalid", "true");
  else target.control.removeAttribute("aria-invalid");
}

export function input(attrs: Record<string, string | number> = {}): HTMLInputElement {
  return h("input", { class: "input", type: "text", autocomplete: "off", spellcheck: "false", ...attrs });
}
