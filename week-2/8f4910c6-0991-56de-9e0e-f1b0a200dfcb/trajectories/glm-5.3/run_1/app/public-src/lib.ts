/** Client helpers: DOM, focus, forms with the Problems summary, and API calls. */

export type Json = Record<string, unknown>;

export interface ApiError {
  status: number;
  code: string;
  body: Json;
}

export class ApiFail extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: Json) {
    super(code);
  }
}

export async function api(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean } = {}): Promise<unknown> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method: options.method || (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  if (options.raw) {
    if (!res.ok) throw new ApiFail(res.status, await errCode(res), {});
    return res;
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Json) : {};
  if (!res.ok) {
    throw new ApiFail(res.status, (body.error as string) || "error", body);
  }
  return body;
}

async function errCode(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return ((JSON.parse(text) as Json).error as string) || "error";
  } catch {
    return "error";
  }
}

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "date" | "number" | "datetime-local" | "textarea" | "select" | "radio" | "file" | "checkbox";
  options?: Array<[string, string]>;
  required?: boolean;
  hint?: string;
  value?: string | number | null;
  checked?: boolean;
  attrs?: Record<string, string>;
}

export interface FormState {
  values: Record<string, string>;
  errors: Record<string, string>;
  keepDraft?: (values: Record<string, string>) => void;
}

/** A form that shows field errors inline and in the Problems summary. */
export function buildForm(
  form: HTMLFormElement,
  fields: FieldSpec[],
  state: FormState,
  onSubmit: (values: Record<string, string>) => void
): void {
  void state;
  form.setAttribute("novalidate", "");
  for (const field of fields) {
    form.appendChild(fieldRow(field));
  }
  const summary = problemsRegion();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = readValues(form, fields);
    state.keepDraft?.(values);
    onSubmit(values);
  });
  form.addEventListener("input", () => {
    const values = readValues(form, fields);
    state.keepDraft?.(values);
  });
  form.prepend(summary);
  renderProblems(summary, state.errors, form, fields);
}

function fieldRow(field: FieldSpec): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = field.label;
  label.htmlFor = `f-${field.name}`;
  wrap.appendChild(label);
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (field.type === "textarea") {
    const t = document.createElement("textarea");
    if (field.value !== undefined && field.value !== null) t.value = String(field.value);
    input = t;
  } else if (field.type === "select") {
    const s = document.createElement("select");
    for (const [value, text] of field.options || []) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      s.appendChild(o);
    }
    if (field.value !== undefined && field.value !== null) s.value = String(field.value);
    input = s;
  } else if (field.type === "radio") {
    const group = document.createElement("div");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", field.label);
    const name = `f-${field.name}`;
    for (const [value, text] of field.options || []) {
      const id = `${name}-${value}`;
      const r = document.createElement("input");
      r.type = "radio";
      r.name = name;
      r.value = value;
      r.id = id;
      if (String(field.value ?? "") === value) r.checked = true;
      const l = document.createElement("label");
      l.htmlFor = id;
      l.textContent = text;
      group.append(r, l);
    }
    wrap.appendChild(group);
    const error = document.createElement("p");
    error.className = "field-error";
    error.dataset.errorFor = field.name;
    error.hidden = true;
    wrap.appendChild(error);
    return wrap;
  } else if (field.type === "checkbox") {
    const box = document.createElement("div");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.name = `f-${field.name}`;
    c.id = `f-${field.name}`;
    c.checked = !!field.checked;
    const l = document.createElement("label");
    l.htmlFor = `f-${field.name}`;
    l.textContent = field.label;
    box.append(c, l);
    return box;
  } else {
    const i = document.createElement("input");
    i.type = field.type || "text";
    if (field.value !== undefined && field.value !== null) i.value = String(field.value);
    input = i;
  }
  input.id = `f-${field.name}`;
  input.name = `f-${field.name}`;
  if (field.attrs) for (const [k, v] of Object.entries(field.attrs)) input.setAttribute(k, v);
  if (field.required) input.setAttribute("required", "");
  if (field.hint) input.setAttribute("aria-describedby", `${input.id}-hint`);
  const hint = document.createElement("p");
  hint.id = `${input.id}-hint`;
  hint.className = "field-error";
  hint.dataset.errorFor = field.name;
  hint.hidden = true;
  wrap.append(input, hint);
  return wrap;
}

export function readValues(form: HTMLFormElement, fields: FieldSpec[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (field.type === "radio") {
      const checked = form.querySelector<HTMLInputElement>(`input[name="f-${field.name}"]:checked`);
      out[field.name] = checked ? checked.value : "";
    } else if (field.type === "checkbox") {
      const el = form.querySelector<HTMLInputElement>(`#f-${field.name}`);
      out[field.name] = el && el.checked ? "1" : "";
    } else {
      const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#f-${field.name}`);
      out[field.name] = el ? (el as HTMLInputElement).value : "";
    }
  }
  return out;
}

export function problemsRegion(): HTMLElement {
  const region = document.createElement("section");
  region.className = "problems";
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "Problems");
  region.hidden = true;
  return region;
}

export function renderProblems(region: HTMLElement, errors: Record<string, string>, scope: ParentNode, fields: FieldSpec[]): void {
  const keys = Object.keys(errors);
  region.hidden = keys.length === 0;
  region.textContent = "";
  if (keys.length === 0) {
    for (const p of Array.from(scope.querySelectorAll<HTMLElement>("[data-error-for]"))) p.hidden = true;
    return;
  }
  const heading = document.createElement("h2");
  heading.textContent = keys.length === 1 ? "There is a problem" : `There are ${keys.length} problems`;
  region.appendChild(heading);
  const list = document.createElement("ul");
  for (const key of keys) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#f-${key}`;
    a.textContent = errors[key];
    a.addEventListener("click", (event) => {
      event.preventDefault();
      const target = scope.querySelector<HTMLElement>(`#f-${key}`) || scope.querySelector<HTMLInputElement>(`input[name="f-${key}"]`);
      target?.focus();
    });
    li.appendChild(a);
    list.appendChild(li);
  }
  region.appendChild(list);
  for (const field of fields) {
    const hint = scope.querySelector<HTMLElement>(`[data-error-for="${field.name}"]`);
    if (hint) {
      const text = errors[field.name];
      if (text) {
        hint.textContent = text;
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }
  }
}

/** Renders inline errors from a 422 response into the Problems region. */
export function applyValidationErrors(region: HTMLElement, scope: ParentNode, fields: FieldSpec[], body: Json): void {
  const errors = (body.errors as Record<string, string>) || {};
  renderProblems(region, errors, scope, fields);
  const first = Object.keys(errors)[0];
  if (first) {
    const target = scope.querySelector<HTMLElement>(`#f-${first}`) || scope.querySelector<HTMLElement>(`input[name="f-${first}"]`);
    target?.focus();
  }
}

export function focusHeading(container: ParentNode): void {
  const heading = container.querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

export function focusElement(target: HTMLElement | null): void {
  if (target) {
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: false });
  }
}

export function announce(status: HTMLElement | null, message: string): void {
  if (!status) return;
  status.textContent = "";
  const p = document.createElement("p");
  p.textContent = message;
  status.appendChild(p);
}

export function dialogError(dialog: HTMLElement, message: string): void {
  let region = dialog.querySelector<HTMLElement>(".dialog-problems");
  if (!region) {
    region = problemsRegion();
    region.className = "problems dialog-problems";
    dialog.prepend(region);
  }
  const text = document.createElement("p");
  text.className = "status-error";
  text.textContent = `Error: ${message}`;
  region.hidden = false;
  region.textContent = "";
  region.appendChild(text);
  text.setAttribute("tabindex", "-1");
  text.focus();
}

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function link(href: string, text: string, className?: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  if (className) a.className = className;
  a.setAttribute("data-nav", "");
  return a;
}

export function button(text: string, onClick: () => void, className?: string, attrs?: Record<string, string>): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (className) b.className = className;
  for (const [k, v] of Object.entries(attrs || {})) b.setAttribute(k, v);
  b.addEventListener("click", onClick);
  return b;
}

/** Pending state on a button: text changes and the button is disabled. */
export function pending(btn: HTMLButtonElement, pendingText: string, action: () => Promise<void>): Promise<void> {
  const original = btn.textContent || "";
  btn.textContent = pendingText;
  btn.disabled = true;
  return action().finally(() => {
    btn.textContent = original;
    btn.disabled = false;
  });
}
