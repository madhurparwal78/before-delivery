import { CONTACT, LEGAL, PRIVACY } from "../copy.js";
import { h } from "../dom.js";

type InfoPage = "contact" | "privacy" | "legal";

/** Contact, Privacy and Legal: a heading and the published copy. */
export function renderInfo(page: InfoPage): HTMLElement {
  if (page === "contact") {
    return h("div", { class: "page info-page" },
      h("h1", { tabindex: "-1" }, CONTACT.title),
      ...CONTACT.lines.map((line) => h("p", {}, line)),
      h("p", {}, h("a", { class: "text-link", href: `mailto:${CONTACT.email}` }, CONTACT.email)));
  }
  const copy = page === "privacy" ? PRIVACY : LEGAL;
  return h("div", { class: "page info-page" }, h("h1", { tabindex: "-1" }, copy.title), h("p", {}, copy.text));
}
