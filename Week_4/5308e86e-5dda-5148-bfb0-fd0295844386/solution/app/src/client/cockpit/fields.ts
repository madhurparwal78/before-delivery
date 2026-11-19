/** Field-level messages: shown under the field, marked invalid and described by the message; the first failing field takes focus. */
import { h, query } from "../shared/dom.js";

function messageFor(input: HTMLElement): HTMLElement {
  const holder = input.closest(".field");
  if (!holder) throw new Error("input outside a .field");
  let message = holder.querySelector<HTMLElement>(".field-error");
  if (!message) {
    message = h("p", { class: "field-error", id: `${input.id}-error` });
    holder.append(message);
  }
  return message;
}

export function showError(input: HTMLElement, text: string): void {
  const message = messageFor(input);
  message.textContent = text;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", message.id);
}

export function clearErrors(form: HTMLElement): void {
  for (const input of form.querySelectorAll<HTMLElement>("[aria-invalid]")) {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
  for (const message of form.querySelectorAll<HTMLElement>(".field-error")) message.textContent = "";
}

/** Focuses the first of `order` that is invalid. */
export function focusFirstInvalid(form: HTMLElement, order: string[]): void {
  for (const id of order) {
    const input = query(form, `#${id}`);
    if (input.getAttribute("aria-invalid") === "true") {
      input.focus();
      return;
    }
  }
}

export function field(id: string, label: string, control: HTMLElement): HTMLElement {
  control.id = id;
  return h("div", { class: "field" }, h("label", { for: id }, label), control, h("p", { class: "field-error", id: `${id}-error` }));
}
