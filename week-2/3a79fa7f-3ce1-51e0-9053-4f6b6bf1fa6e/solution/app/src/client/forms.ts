// Labelled fields with their error line (red ring icon + API message) tied as the field's description.
import { h, uid, type Attrs } from "./dom.ts";
import { icon } from "./icons.ts";
import type { Refusal } from "./api.ts";

export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface Field<C extends Control = Control> {
  wrap: HTMLElement;
  control: C;
  setError(message: string | null): void;
}

function withError<C extends Control>(label: Node, control: C, hint?: string): Field<C> {
  const errorId = uid("err");
  const text = h("span");
  const error = h("p", { class: "field-error", id: errorId, hidden: true }, icon("error", 18, "icon error-icon"), text);
  const hintEl = hint ? h("p", { class: "hint", id: uid("hint") }, hint) : null;
  control.setAttribute("aria-describedby", [hintEl?.id, errorId].filter(Boolean).join(" "));
  const wrap = h("div", { class: "field" }, label, hintEl, control, error);
  return {
    wrap,
    control,
    setError(message) {
      error.hidden = !message;
      text.textContent = message ?? "";
      if (message) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    },
  };
}

export function input(labelText: string, attrs: Attrs = {}, hint?: string): Field<HTMLInputElement> {
  const id = uid("f");
  const control = h("input", { id, type: "text", ...attrs });
  return withError(h("label", { for: id }, labelText), control, hint);
}

export function textarea(labelText: string, attrs: Attrs = {}): Field<HTMLTextAreaElement> {
  const id = uid("f");
  const control = h("textarea", { id, rows: 4, ...attrs });
  return withError(h("label", { for: id }, labelText), control);
}

export function select(labelText: string, options: { value: string; label: string }[], attrs: Attrs = {}): Field<HTMLSelectElement> {
  const id = uid("f");
  const control = h("select", { id, ...attrs }, options.map((o) => h("option", { value: o.value }, o.label)));
  return withError(h("label", { for: id }, labelText), control);
}

/** A form with its own alert region for refusals that belong to no field. */
export function form(attrs: Attrs, ...children: (Node | null | false)[]): { el: HTMLFormElement; alert: HTMLElement } {
  const alert = h("div", { role: "alert", class: "form-alert" });
  const el = h("form", { novalidate: true, ...attrs }, ...children, alert);
  return { el, alert };
}

/**
 * Shows a refusal: field messages beneath their fields (focus to the first refused field in page order) or the
 * API message in the form's alert region. Returns true when any field took a message.
 */
export function showRefusal(refusal: Refusal, fields: Record<string, Field>, alert: HTMLElement | null): boolean {
  for (const f of Object.values(fields)) f.setError(null);
  const refused = Object.entries(refusal.fields ?? {}).filter(([name]) => fields[name]);
  for (const [name, message] of refused) fields[name]!.setError(message);
  if (refused.length) {
    const first = Object.values(fields).find((f) => f.control.getAttribute("aria-invalid") === "true");
    first?.control.focus();
    if (alert) alert.textContent = "";
    return true;
  }
  if (alert) alert.textContent = refusal.message;
  return false;
}

export function clearErrors(fields: Record<string, Field>, alert: HTMLElement | null): void {
  for (const f of Object.values(fields)) f.setError(null);
  if (alert) alert.textContent = "";
}

/** Disables a button and shows its pending label while `work` runs. */
export async function busy<T>(button: HTMLButtonElement, pending: string, work: () => Promise<T>): Promise<T> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = pending;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
