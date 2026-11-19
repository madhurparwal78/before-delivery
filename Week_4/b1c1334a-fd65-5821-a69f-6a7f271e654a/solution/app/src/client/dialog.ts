// Dialogs, full-height sheets and the Tables drawer: focus kept inside, Escape closes,
// focus returns to the opener.
import { h, icon, layoutOf, overlay, reducedMotion } from "./dom.js";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const open: Dialog[] = [];

export function anyDialogOpen(): boolean {
  return open.length > 0;
}

interface DialogOptions {
  title: string;
  returnTo: () => HTMLElement | null;
  drawer?: boolean;
  onClose?: () => void;
  extraClass?: string;
}

let counter = 0;

export class Dialog {
  readonly panel: HTMLElement;
  readonly body: HTMLElement;
  private readonly root: HTMLElement;
  private enterTimer = 0;
  private closed = false;

  constructor(private readonly options: DialogOptions) {
    const id = `dialog-title-${++counter}`;
    const sheet = !options.drawer && layoutOf() === "phone";
    this.body = h("div", { class: "dialog-body" });
    this.panel = h(
      "div",
      {
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": id,
        class: `dialog ${options.drawer ? "drawer" : sheet ? "sheet" : "modal"} ${options.extraClass ?? ""}`,
      },
      h("h2", { id, class: "dialog-title" }, options.title),
      this.body,
    );
    this.root = h("div", { class: `scrim ${options.drawer ? "scrim-drawer" : ""}` }, this.panel);
    this.panel.addEventListener("keydown", (e) => this.keydown(e));
    this.root.addEventListener("mousedown", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  show(): void {
    open.push(this);
    overlay().append(this.root);
    const animated = !reducedMotion.matches;
    if (animated && (this.panel.classList.contains("sheet") || this.panel.classList.contains("drawer"))) {
      this.panel.setAttribute("data-entering", "true");
      this.enterTimer = window.setTimeout(() => this.panel.removeAttribute("data-entering"), this.panel.classList.contains("sheet") ? 200 : 220);
    }
    reducedMotion.addEventListener("change", this.motionChanged);
    const first = this.panel.querySelector<HTMLElement>("input:not([type=radio]):not([disabled]), textarea, select") ??
      this.panel.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }

  private readonly motionChanged = () => {
    if (reducedMotion.matches) {
      clearTimeout(this.enterTimer);
      this.panel.removeAttribute("data-entering");
    }
  };

  get isOpen(): boolean {
    return !this.closed;
  }

  close(restoreFocus = true): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.enterTimer);
    reducedMotion.removeEventListener("change", this.motionChanged);
    this.root.remove();
    open.splice(open.indexOf(this), 1);
    this.options.onClose?.();
    if (restoreFocus) this.options.returnTo()?.focus();
  }

  private keydown(e: KeyboardEvent): void {
    if (open[open.length - 1] !== this) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...this.panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || !this.panel.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !this.panel.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  }
}

// A field with its label, message slot and the invalid state the brief asks for.
export function field(label: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): { wrap: HTMLElement; setError: (message: string | null) => void } {
  const id = `field-${++counter}`;
  control.id = id;
  const message = h("p", { class: "field-message", id: `${id}-message` });
  // The error icon sits inside the field, at its right edge; the message reads below it.
  const wrap = h("div", { class: "field" }, h("label", { for: id }, label), h("div", { class: "field-control" }, control, icon("alert")), message);
  const setError = (text: string | null) => {
    if (text) {
      message.replaceChildren(text);
      control.setAttribute("aria-invalid", "true");
      control.setAttribute("aria-describedby", message.id);
      wrap.classList.add("invalid");
    } else {
      message.replaceChildren();
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
      wrap.classList.remove("invalid");
    }
  };
  control.addEventListener("input", () => setError(null));
  return { wrap, setError };
}

export function radioGroup(name: string, label: string, options: [string, string][], checked: string): { group: HTMLElement; value: () => string; radios: HTMLInputElement[] } {
  const radios: HTMLInputElement[] = [];
  const group = h("div", { role: "radiogroup", "aria-label": label, class: "radios" }, h("span", { class: "group-label", "aria-hidden": "true" }, label));
  for (const [value, text] of options) {
    const input = h("input", { type: "radio", name, value }) as HTMLInputElement;
    input.checked = value === checked;
    radios.push(input);
    group.append(h("label", { class: "radio" }, input, h("span", {}, text)));
  }
  return { group, radios, value: () => radios.find((r) => r.checked)?.value ?? checked };
}
