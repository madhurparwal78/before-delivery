/**
 * Case-study page wiring: the gallery return link and the neighbour links.
 * `Back to work` marks the return so the home page can restore the filters and
 * focus that project's card link.
 */
import { qs } from "./core.js";

export function initCaseStudy(): void {
  if (!document.body.classList.contains("page-case")) return;
  const back = qs<HTMLAnchorElement>("[data-back-to-work]");
  if (back) {
    back.addEventListener("click", () => {
      const match = /\/work\/([a-z0-9-]+)/.exec(window.location.pathname);
      if (match) sessionStorage.setItem("quillfern-return", match[1]);
    });
  }
}
