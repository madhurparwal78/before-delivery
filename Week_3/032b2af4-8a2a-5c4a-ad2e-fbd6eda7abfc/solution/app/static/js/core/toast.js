import { h, icon } from "./dom.js";

let current = null;

/** A short confirmation that does not move the page. It closes by itself, and stays while hovered or focused. */
export function toast(message) {
  current?.remove();
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    node.remove();
    if (current === node) current = null;
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(close, 5000);
  };
  const node = h("div", { class: "toast", role: "status", onmouseenter: () => clearTimeout(timer), onmouseleave: arm, onfocusin: () => clearTimeout(timer), onfocusout: arm },
    h("span", { text: message }),
    h("button", { class: "icon-button", type: "button", "aria-label": "Close message", onclick: close }, icon("close")));
  document.body.append(node);
  current = node;
  arm();
}
