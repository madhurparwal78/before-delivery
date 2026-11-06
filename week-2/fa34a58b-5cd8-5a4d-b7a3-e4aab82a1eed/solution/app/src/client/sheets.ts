// Sheets and drawers: open from a control, trap Tab and Shift+Tab, close on Escape, Close or the
// backdrop, and return focus. A closing sheet stops blocking at once; reopening it keeps it open.
// Adapted from kit/modules/a11y_dialog with a stack, an inert page and close timers.

import { h, reducedMotion } from "./dom.ts";

const DURATION_MS = 320;
const stack: Sheet[] = [];

const TABBABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => {
    if (element.matches(":disabled") || element.tabIndex < 0 || !element.checkVisibility()) return false;
    if (element instanceof HTMLInputElement && element.type === "radio" && !element.checked) {
      const group = root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${element.name}"]`);
      return ![...group].some((radio) => radio.checked) && group[0] === element;
    }
    return true;
  });
}

/** Everything outside the top sheet is inert while any sheet is open (announcements excepted). */
function syncInert(): void {
  const top = stack[stack.length - 1];
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement) || child.dataset.neverInert !== undefined) continue;
    child.inert = top !== undefined && child !== top.element && child !== top.backdrop;
  }
}

document.addEventListener("keydown", (event) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === "Escape") {
    event.preventDefault();
    top.close();
    return;
  }
  if (event.key !== "Tab") return;
  const items = tabbables(top.element);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (!top.element.contains(active)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && (active === first || active === top.element)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
});

document.addEventListener("focusin", (event) => {
  const top = stack[stack.length - 1];
  if (top && !top.element.contains(event.target as Node)) tabbables(top.element)[0]?.focus();
});

interface SheetOptions {
  /** The element that is the sheet (created when omitted). */
  element?: HTMLElement;
  label: string;
  className?: string;
  /** When set, the element is a sheet only while this query matches; otherwise it is page content. */
  onlyWhen?: MediaQueryList;
  /** The role the element has while it is page content. */
  pageRole?: string;
  onClose?: () => void;
}

export class Sheet {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  private state: "closed" | "open" | "closing" = "closed";
  private timer: number | undefined;
  private returnTo: HTMLElement | null = null;
  private readonly options: SheetOptions;
  private label: string;

  constructor(options: SheetOptions) {
    this.options = options;
    this.label = options.label;
    this.element = options.element ?? h("div", { class: `sheet ${options.className ?? ""}` });
    this.element.classList.add("sheet");
    this.backdrop = h("div", { class: "backdrop", hidden: true, "aria-hidden": "true" });
    this.backdrop.addEventListener("click", () => this.close());
    if (!this.element.isConnected) document.body.append(this.element);
    document.body.append(this.backdrop);
    this.setLabel(options.label);
    this.applyMode();
    options.onlyWhen?.addEventListener("change", () => {
      if (this.state !== "closed") this.close();
      this.applyMode();
    });
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  /** Whether this element is acting as a sheet at the current viewport. */
  get modal(): boolean {
    return !this.options.onlyWhen || this.options.onlyWhen.matches;
  }

  setLabel(label: string): void {
    this.label = label;
    if (this.modal || this.options.pageRole) this.element.setAttribute("aria-label", label);
  }

  private applyMode(): void {
    if (this.modal || this.options.pageRole) this.element.setAttribute("aria-label", this.label);
    else this.element.removeAttribute("aria-label");
    if (this.modal) {
      this.element.setAttribute("role", "dialog");
      this.element.setAttribute("aria-modal", "true");
      this.element.hidden = this.state === "closed";
    } else {
      if (this.options.pageRole) this.element.setAttribute("role", this.options.pageRole);
      else this.element.removeAttribute("role");
      this.element.removeAttribute("aria-modal");
      this.element.hidden = false;
      this.element.classList.remove("is-open", "is-closing");
    }
  }

  /** Opens the sheet; focus moves to its first control and returns to `returnTo` on close. */
  open(returnTo: HTMLElement | null): void {
    if (!this.modal) return;
    this.returnTo = returnTo;
    window.clearTimeout(this.timer);
    const wasClosed = this.state === "closed";
    this.state = "open";
    this.element.hidden = false;
    this.backdrop.hidden = false;
    this.element.classList.remove("is-closing");
    this.backdrop.classList.remove("is-closing");
    if (wasClosed) void this.element.offsetWidth; // start the slide from its closed position
    this.element.classList.add("is-open");
    this.backdrop.classList.add("is-open");
    if (!stack.includes(this)) stack.push(this);
    const depth = stack.indexOf(this);
    this.backdrop.style.zIndex = String(50 + depth * 2);
    this.element.style.zIndex = String(51 + depth * 2);
    syncInert();
    tabbables(this.element)[0]?.focus();
  }

  close(): void {
    if (this.state !== "open") return;
    this.state = "closing";
    stack.splice(stack.indexOf(this), 1);
    syncInert();
    this.element.classList.remove("is-open");
    this.backdrop.classList.remove("is-open");
    this.element.classList.add("is-closing");
    this.backdrop.classList.add("is-closing");
    const finish = () => {
      if (this.state !== "closing") return;
      this.state = "closed";
      this.element.hidden = true;
      this.backdrop.hidden = true;
      this.element.classList.remove("is-closing");
      this.backdrop.classList.remove("is-closing");
    };
    if (reducedMotion.matches) finish();
    else this.timer = window.setTimeout(finish, DURATION_MS);
    if (this.returnTo?.isConnected) this.returnTo.focus();
    this.options.onClose?.();
  }
}

/** The standard sheet header: a Close button and the sheet's title. */
export function sheetHeader(sheet: () => Sheet, title: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "sheet-head" },
    title,
    h("button", { class: "btn btn-quiet", type: "button", onclick: () => sheet().close() }, "Close"),
  );
}
