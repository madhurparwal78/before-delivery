// Shared UI components and helpers.
import { ApiFail } from "./api.js";

export function h<T extends HTMLElement = HTMLElement>(tag: string, attrs: Record<string, unknown> | null, ...children: unknown[]): T {
  const el = document.createElement(tag) as T;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = String(value);
      else if (key === "text") el.textContent = String(value);
      else if (key === "html") el.innerHTML = String(value);
      else if (value === true) el.setAttribute(key, "");
      else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2), value as EventListener);
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof HTMLElement) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
  return el;
}

/** A live region with the given polite role name. */
export function liveRegion(name: string): HTMLElement {
  return h("div", { class: "live-region", role: name, "aria-live": "polite", "aria-label": name, id: `region-${slug(name)}` });
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** A visible status line plus the hidden polite region. */
export function announce(region: HTMLElement, message: string): void {
  region.textContent = message;
}

export function errorFields(e: unknown): Record<string, string> {
  if (e instanceof ApiFail && e.body.fields) return e.body.fields;
  return {};
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiFail) return e.body.message;
  return "Something went wrong.";
}

/** The Fix these fields alert: one link per invalid field. */
export function fixFieldsAlert(fields: Record<string, string>, focusTargets: Record<string, HTMLElement>): HTMLElement {
  const alert = h("div", { class: "alert-fix", role: "alert" });
  const heading = h("h4", { text: "Fix these fields" });
  alert.appendChild(heading);
  const list = h("ul", null);
  for (const [field, message] of Object.entries(fields)) {
    const li = h("li", null);
    const target = focusTargets[field];
    const link = h("a", {
      href: "#",
      text: message,
      onclick: (event: Event) => {
        event.preventDefault();
        if (target) target.focus();
      },
    });
    li.appendChild(link);
    list.appendChild(li);
  }
  alert.appendChild(list);
  return alert;
}

/** A dialog wrapper with focus trap, Escape and focus return. */
export class Dialog {
  el: HTMLDialogElement;
  private opener: HTMLElement | null;
  private controls: HTMLElement[] = [];

  constructor(
    public name: string,
    build: (dialog: Dialog) => HTMLElement,
    opener: HTMLElement | null,
  ) {
    this.opener = opener;
    this.el = document.createElement("dialog");
    this.el.className = "sheet";
    this.el.setAttribute("aria-label", name);
    const form = build(this);
    this.el.appendChild(form);
    this.el.addEventListener("close", () => {
      if (this.opener && document.contains(this.opener)) this.opener.focus();
    });
    this.el.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
  }

  registerControls(controls: HTMLElement[]): void {
    this.controls = controls;
  }

  open(): void {
    document.body.appendChild(this.el);
    this.el.showModal();
    const first = this.firstFocusable();
    if (first) first.focus();
  }

  close(): void {
    this.el.close();
    this.el.remove();
  }

  private firstFocusable(): HTMLElement | null {
    return this.controls[0] ?? this.el.querySelector<HTMLElement>("input, select, textarea, button");
  }
}

export function dialogTrap(dialog: Dialog, root: HTMLElement): void {
  const focusables = (): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex]:not([tabindex='-1'])"))
      .filter((el) => !el.hasAttribute("disabled"));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement as HTMLElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.registerControls(focusables());
}

/** Format an ISO time in the club's time zone. */
export function localTime(iso: string, timeZone: string, withDate: boolean): string {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const time = `${map.hour === "24" ? "00" : map.hour}:${map.minute}`;
  return withDate ? `${map.year}-${map.month}-${map.day} ${time}` : time;
}

export function pendingButton(button: HTMLElement, pendingText: string): () => void {
  const original = button.textContent;
  (button as HTMLButtonElement).disabled = true;
  button.classList.add("dimmed");
  button.textContent = pendingText;
  return () => {
    (button as HTMLButtonElement).disabled = false;
    button.classList.remove("dimmed");
    button.textContent = original ?? "";
  };
}

export const statusLabels: Record<string, string> = {
  draft: "Draft",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  running: "Running",
  provisional: "Provisional",
  final: "Final",
  published: "Published",
};

/** A labelled form field wrapper. */
export function fieldFor(label: string, input: HTMLElement): HTMLElement {
  const id = (input as HTMLInputElement).id || `f-${Math.random().toString(36).slice(2)}`;
  (input as HTMLInputElement).id = id;
  return h("div", { class: "field" }, h("label", { for: id, text: label }), input);
}
