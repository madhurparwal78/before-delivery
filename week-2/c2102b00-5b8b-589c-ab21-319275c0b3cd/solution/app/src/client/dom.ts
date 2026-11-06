// Small DOM and formatting helpers shared by every screen.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((event: any) => void)>;

/** Creates an element: `on*` attributes become listeners, `true` becomes an empty attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "class") el.className = String(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** `$1,234.56` */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.trunc(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** A caps noun label beside its value. */
export function labelled(label: string, value: Node | string, className = "figure"): HTMLElement {
  return h("p", { class: className }, h("span", { class: "label" }, label), " ", typeof value === "string" ? h("span", { class: "value" }, value) : value);
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Busy state that keeps keyboard focus: the control refuses activation but stays focusable. */
export function setBusy(button: HTMLButtonElement, busy: boolean, pendingText: string, idleText: string): void {
  button.setAttribute("aria-disabled", busy ? "true" : "false");
  button.classList.toggle("busy", busy);
  button.textContent = busy ? pendingText : idleText;
}

export const isBusy = (button: HTMLElement) => button.getAttribute("aria-disabled") === "true";

/** Ties a field to its error text, or removes the description when there is none. */
export function setFieldError(field: HTMLElement, errorEl: HTMLElement, text: string | null): void {
  errorEl.textContent = text ?? "";
  errorEl.hidden = !text;
  if (text) {
    field.setAttribute("aria-describedby", errorEl.id);
    field.setAttribute("aria-invalid", "true");
  } else {
    field.removeAttribute("aria-describedby");
    field.removeAttribute("aria-invalid");
  }
}
