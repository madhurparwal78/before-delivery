// Shared form behaviour: pending buttons and field errors linked to their fields.

import { h } from "../dom.js";

/** Shows the pending copy over a static hatch (no spinner); `null` restores the button. */
export function setPending(button: HTMLButtonElement, copy: string | null): void {
  const face = button.querySelector(".button__face") ?? button;
  if (copy) {
    button.dataset.idle ??= face.textContent ?? "";
    face.textContent = copy;
    button.classList.add("is-pending");
    button.setAttribute("aria-disabled", "true");
  } else {
    if (button.dataset.idle !== undefined) face.textContent = button.dataset.idle;
    delete button.dataset.idle;
    button.classList.remove("is-pending");
    button.removeAttribute("aria-disabled");
  }
}

/** An error line under a field, linked to it as its description. */
export function fieldError(field: HTMLElement): HTMLParagraphElement {
  const id = `${field.id}-error`;
  const line = h("p", { id, class: "field__error", hidden: true });
  field.setAttribute("aria-describedby", id);
  return line;
}

export function showFieldErrors(fields: Record<string, string>, lines: Record<string, HTMLElement>): void {
  for (const [name, line] of Object.entries(lines)) {
    const copy = fields[name];
    line.textContent = copy ?? "";
    line.hidden = !copy;
    const field = document.querySelector(`[aria-describedby~="${line.id}"]`);
    if (copy) field?.setAttribute("aria-invalid", "true");
    else field?.removeAttribute("aria-invalid");
  }
}

export function primaryButton(text: string, attrs: Record<string, string | boolean> = {}): HTMLButtonElement {
  return h("button", { type: "button", class: "button button--primary", ...attrs }, h("span", { class: "button__face" }, text));
}

export function plainButton(text: string, attrs: Record<string, string | boolean> = {}): HTMLButtonElement {
  return h("button", { type: "button", class: "button", ...attrs }, h("span", { class: "button__face" }, text));
}
