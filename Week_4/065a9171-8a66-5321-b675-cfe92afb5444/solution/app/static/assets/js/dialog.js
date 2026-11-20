// Modal dialogs (adapted from kit/modules/a11y_dialog): focus moves in, Tab stays inside,
// Escape or Close shuts it and focus returns to the opener. Fades and rises in 200ms.
import { h, reducedMotion } from "./dom.js";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function dialog(title, ...content) {
  const heading = h("h2", { class: "dialog-title", text: title });
  const closeButton = h("button", { type: "button", class: "quiet", text: "Close" });
  const el = h("dialog", { class: "dialog", "aria-label": title }, heading, ...content, h("div", { class: "dialog-close" }, closeButton));
  let opener = null;

  function trap(event) {
    if (event.key !== "Tab") return;
    const items = [...el.querySelectorAll(FOCUSABLE)];
    const edge = event.shiftKey ? items[0] : items[items.length - 1];
    if (document.activeElement === edge || !el.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  }

  async function close() {
    if (!el.open) return;
    if (!reducedMotion()) {
      await el.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(8px)" }],
        { duration: 200, easing: EASE }).finished;
    }
    el.close();
    opener?.focus();
  }

  function open(from, focusTarget) {
    opener = from;
    if (!el.isConnected) document.body.append(el);
    el.showModal();
    (focusTarget ?? el.querySelector(FOCUSABLE)).focus();
    if (!reducedMotion()) {
      el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 200, easing: EASE });
    }
  }

  el.addEventListener("keydown", trap);
  el.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  closeButton.addEventListener("click", close);
  return { el, open, close };
}
