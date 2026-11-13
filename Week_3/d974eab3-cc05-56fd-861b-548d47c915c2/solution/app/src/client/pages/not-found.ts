import { brokenPath } from "../art/ornaments.js";
import { h } from "../dom.js";

/** A page that cannot be found: its heading, the broken path and one link back. */
export function notFound(heading: string, linkText: string, href: string): HTMLElement {
  return h("div", { class: "page not-found" }, brokenPath(), h("h1", { tabindex: "-1" }, heading), h("p", {}, h("a", { class: "text-link", href }, linkText)));
}
