import { CONTENT_ALERT } from "../copy.js";
import { h } from "../dom.js";
import { icon } from "../icons.js";

/** Shown by any page whose content cannot be read. */
export function contentAlert(): HTMLElement {
  return h("div", { class: "page" }, h("div", { class: "alert", role: "alert" }, icon("warning"), h("span", {}, CONTENT_ALERT)));
}
