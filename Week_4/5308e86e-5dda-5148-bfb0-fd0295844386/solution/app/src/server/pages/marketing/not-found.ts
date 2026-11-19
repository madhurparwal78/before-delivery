/** The not-found page: the chrome, a short apology and a way home. */
import type { RenderedPage } from "../layout.js";
import { marketingDocument } from "./chrome.js";
import { hero, linkButton, pageTitle } from "./parts.js";

export function notFoundPage(): RenderedPage {
  return marketingDocument({
    title: pageTitle("Page not found"),
    page: "not-found",
    main: hero({
      id: "not-found-title",
      title: "We couldn't find that page",
      lede: "The address may have changed, or it may never have existed. Head back to the start and pick up from there.",
      className: "hero-compact",
      actions: `<div class="hero-actions">${linkButton("/", "Go to the home page", "primary", "arrowRight")}</div>`,
    }),
  });
}
