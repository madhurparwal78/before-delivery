import { moveFocus, trapTab } from "./focus.js";

function required<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (el === null) throw new Error(`Menu markup missing: ${selector}`);
  return el;
}

function outside(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".site-header, main, .site-footer, .skip-link")];
}

/** The modal navigation used below 1024 pixels wide. */
export class Menu {
  private readonly button = required<HTMLButtonElement>(".menu-button");
  private readonly dialog = required<HTMLElement>(".menu");
  private readonly backdrop = required<HTMLElement>(".menu-backdrop");
  private open = false;

  constructor() {
    this.button.addEventListener("click", () => this.show());
    required<HTMLButtonElement>(".menu-close").addEventListener("click", () => this.close(true));
    this.backdrop.addEventListener("click", () => this.close(true));
    this.dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close(true);
      } else trapTab(this.dialog, event);
    });
    this.dialog.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a") !== null) this.close(false);
    });
    window.matchMedia("(min-width: 1024px)").addEventListener("change", (event) => {
      if (event.matches) this.close(false);
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  close(returnFocus: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.dialog.classList.remove("open");
    this.dialog.inert = true;
    this.dialog.setAttribute("aria-hidden", "true");
    this.backdrop.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    for (const el of outside()) el.inert = false;
    if (returnFocus) moveFocus(this.button);
  }

  private show(): void {
    this.open = true;
    for (const el of outside()) el.inert = true;
    this.dialog.inert = false;
    this.dialog.removeAttribute("aria-hidden");
    this.dialog.classList.add("open");
    this.backdrop.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    moveFocus(this.dialog.querySelector<HTMLElement>("nav a"));
  }
}
