import { h, prefersReducedMotion, type Child } from "../dom";
import { collapseMenu } from "../shell";

interface DialogOptions {
  readonly title: string;
  readonly body: Child[];
  readonly actions: HTMLElement[];
  // Called for Escape; omitted when the dialog cannot be dismissed.
  readonly onEscape?: () => void;
  readonly initialFocus?: HTMLElement;
  // Docks the dialog at the side so it never covers the race view.
  readonly docked?: boolean;
}

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
let dialogCount = 0;

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
}

// A modal dialog: the page behind is inert, Tab and Shift+Tab wrap inside, Escape calls onEscape.
export function openDialog(options: DialogOptions) {
  collapseMenu();
  const app = document.getElementById("app");
  const titleId = `dialog-title-${++dialogCount}`;
  const content = h("div", { class: "dialog-body" }, ...options.body);
  const actionsBar = h("div", { class: "dialog-actions" }, ...options.actions);
  const element = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId, class: "dialog-title" }, options.title), content, actionsBar);
  const scrim = h("div", { class: options.docked ? "scrim docked" : "scrim" }, element);
  document.body.append(scrim);
  app?.setAttribute("inert", "");

  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(element);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !element.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !element.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });

  const reduced = prefersReducedMotion();
  if (!reduced) {
    element.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: EASE });
  }
  (options.initialFocus ?? focusables(element)[0] ?? element).focus();

  let closed = false;
  return {
    element,
    content,
    actionsBar,
    close() {
      if (closed) return;
      closed = true;
      scrim.style.pointerEvents = "none";
      element.removeAttribute("role");
      element.setAttribute("aria-hidden", "true");
      if (!document.querySelector(".dialog[role=dialog]")) app?.removeAttribute("inert");
      if (reduced) {
        scrim.remove();
        return;
      }
      element.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(6px)" }], { duration: 120, easing: EASE, fill: "forwards" })
        .finished.then(() => scrim.remove(), () => scrim.remove());
    },
  };
}
