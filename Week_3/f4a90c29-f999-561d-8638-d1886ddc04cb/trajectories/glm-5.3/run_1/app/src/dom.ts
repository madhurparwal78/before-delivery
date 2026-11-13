// dom.ts — tiny helpers for building the published controls with their
// accessible names.

export type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Record<string, unknown> | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v as string;
      else if (k === "text") el.textContent = v as string;
      else if (k === "html") el.innerHTML = v as string;
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === "value") {
        (el as HTMLInputElement).value = v as string;
      } else if (k === "checked") {
        (el as HTMLInputElement).checked = v as boolean;
      } else if (k === "for") {
        el.setAttribute("for", v as string);
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c as Node);
  }
}

// labelled builds a control with its accessible name from the published list.
export function labelled(tag: string, name: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = h(tag, attrs, ...children);
  const role = el.getAttribute("role");
  if (!role && el.getAttribute("aria-label") === null && el.tagName !== "LABEL" && el.tagName !== "TD") {
    el.setAttribute("aria-label", name);
  }
  return el;
}

export function button(name: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  return h("button", { "aria-label": name, ...attrs }, ...children);
}

export function textbox(name: string, value = "", attrs: Record<string, unknown> = {}): HTMLInputElement {
  const el = h("input", { type: "text", value, "aria-label": name, ...attrs }) as HTMLInputElement;
  return el;
}

export function searchbox(name: string, value = ""): HTMLInputElement {
  return h("input", { type: "search", value, "aria-label": name }) as HTMLInputElement;
}

export function checkbox(name: string, checked = false): HTMLInputElement {
  const id = uniqueId();
  const box = h("input", { type: "checkbox", id, checked, "aria-label": name }) as HTMLInputElement;
  return box;
}

export function combobox(name: string, options: { value: string; label: string }[], value?: string): HTMLSelectElement {
  const sel = h("select", { "aria-label": name }) as HTMLSelectElement;
  for (const o of options) {
    const opt = h("option", { value: o.value }, o.label);
    if (o.value === value) (opt as HTMLOptionElement).selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

export function spinbutton(name: string, value: number, min?: number, max?: number): HTMLInputElement {
  return h("input", { type: "number", value: String(value), "aria-label": name, min, max }) as HTMLInputElement;
}

export function radio(name: string, value: string, label: string, checked: boolean): HTMLInputElement {
  const id = uniqueId();
  const wrap = h("span", { class: "radio" });
  const input = h("input", { type: "radio", id, name, value, checked }) as HTMLInputElement;
  if (checked) input.checked = true;
  wrap.append(input, h("label", { for: id }, label));
  return input;
}

export function radiogroupWrap(name: string): HTMLElement {
  return h("div", { role: "radiogroup", "aria-label": name, class: "radiogroup" });
}

export function heading(level: number, ...children: Child[]): HTMLElement {
  return h(`h${level}`, null, ...children);
}

export function statusLine(text: string): void {
  const el = document.getElementById("wren-status");
  if (el) el.textContent = text;
}

let idCounter = 0;
export function uniqueId(): string {
  idCounter += 1;
  return `w${idCounter}`;
}

export function focusTrap(container: HTMLElement): void {
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")
    ).filter((el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

export function dialog(name: string, className = "dialog"): HTMLDialogElement {
  const el = document.createElement("dialog");
  el.className = className;
  el.setAttribute("aria-label", name);
  return el;
}
