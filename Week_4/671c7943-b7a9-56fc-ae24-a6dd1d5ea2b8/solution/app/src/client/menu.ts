import { EASE_OUT, must, reducedMotion } from "./dom.js";

const SLIDE_MS = 280;

/** The Menu sheet: a modal dialog sliding down from the top edge, with its own focus trap. */
export function initMenu(follow: (link: HTMLAnchorElement) => boolean, opened: () => void): void {
  const button = must<HTMLButtonElement>(document, "#menu-button");
  const dialog = must<HTMLDialogElement>(document, "#menu-sheet");
  const focusable = (): HTMLElement[] => Array.from(dialog.querySelectorAll<HTMLElement>("button, a[href]"));
  let closing: Promise<void> | null = null;

  const open = (): void => {
    dialog.showModal();
    button.setAttribute("aria-expanded", "true");
    opened();
    must<HTMLElement>(dialog, "nav a").focus();
    if (!reducedMotion()) dialog.animate([{ transform: "translateY(-100%)" }, { transform: "none" }], { duration: SLIDE_MS, easing: EASE_OUT });
  };

  const close = (returnFocus: boolean): Promise<void> => {
    if (!dialog.open) return Promise.resolve();
    closing ??= (async () => {
      button.setAttribute("aria-expanded", "false");
      if (!reducedMotion()) {
        const slide = dialog.animate([{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: SLIDE_MS, easing: EASE_OUT, fill: "forwards" });
        await slide.finished.catch(() => undefined);
        slide.cancel();
      }
      dialog.close();
      if (returnFocus) button.focus();
      closing = null;
    })();
    return closing;
  };

  button.addEventListener("click", open);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    void close(true);
  });
  dialog.addEventListener("click", (event) => {
    const target = event.target;
    if (target === dialog) void close(true);
    const anchor = target instanceof Element ? target.closest("a") : null;
    if (anchor) {
      event.preventDefault();
      void close(false).then(() => {
        if (!follow(anchor)) location.href = anchor.href;
      });
    } else if (target instanceof Element && target.closest("[data-menu-close]")) {
      void close(true);
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const items = focusable();
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  matchMedia("(min-width: 1024px)").addEventListener("change", (query) => {
    if (query.matches && dialog.open) {
      dialog.close();
      button.setAttribute("aria-expanded", "false");
    }
  });
}
