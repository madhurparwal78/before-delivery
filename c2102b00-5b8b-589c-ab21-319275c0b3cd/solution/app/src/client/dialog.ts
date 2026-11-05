// Modal dialogs: top layer, the page behind inert and still, focus kept inside, Escape closes.
import { h, reducedMotion, uid } from "./dom.js";

const ENTER_MS = 320;
const LEAVE_MS = 180;
const EASE = "cubic-bezier(.55,0,.15,1)";

export interface DialogHandle {
  el: HTMLDialogElement;
  close(): void;
}

interface DialogOptions {
  title: string;
  body: Node[];
  actions: Node[];
  initialFocus: () => HTMLElement;
  onClosed: () => void;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, a[href], select, textarea, [tabindex]")].filter(
    (e) => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled && e.getClientRects().length > 0,
  );
}

let openCount = 0;

export function openDialog(options: DialogOptions): DialogHandle {
  const titleId = uid("dialog-title");
  const el = h(
    "dialog",
    { class: "dialog", "aria-labelledby": titleId },
    h("div", { class: "dialog-frame" },
      h("h2", { class: "dialog-title", id: titleId }, options.title),
      h("div", { class: "dialog-body" }, ...options.body),
      h("div", { class: "dialog-actions" }, ...options.actions),
    ),
  );
  let closing = false;
  /** A still copy of the dialog fades out where it stood, so the page is usable from the first moment. */
  const fadeOut = () => {
    const box = el.getBoundingClientRect();
    const ghost = h("div", { class: "dialog dialog-ghost", "aria-hidden": "true" }, el.firstElementChild!.cloneNode(true));
    ghost.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
    ghost.style.cssText = `position:fixed;margin:0;pointer-events:none;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    document.body.append(ghost);
    const exit = ghost.animate(
      [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(4px)" }],
      { duration: LEAVE_MS, easing: EASE, fill: "forwards" },
    );
    exit.finished.then(() => ghost.remove(), () => ghost.remove());
  };
  const close = () => {
    if (closing) return;
    closing = true;
    if (!reducedMotion()) fadeOut();
    el.close();
    el.remove();
    openCount -= 1;
    if (openCount === 0) document.documentElement.classList.remove("dialog-open");
    options.onClosed();
  };
  el.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const items = focusables(el);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
    event.preventDefault();
    items[next]!.focus();
  });
  document.body.append(el);
  openCount += 1;
  document.documentElement.classList.add("dialog-open");
  el.showModal();
  options.initialFocus().focus();
  if (!reducedMotion()) {
    el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], {
      duration: ENTER_MS,
      easing: EASE,
    });
  }
  return { el, close };
}
