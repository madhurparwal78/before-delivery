import { HERO, HERO_LINE } from "../copy.js";
import { h } from "../dom.js";
import { openingArcs } from "../art/ornaments.js";
import { icon } from "../icons.js";

/** The Opening: the hero words rise in a still pool of light. Nothing here waits for the content read. */
export function createOpening(): HTMLElement {
  const words = HERO.split(" ");
  const heading = h("h1", { id: "opening-title", class: "hero-title", tabindex: "-1" });
  words.forEach((word, index) => {
    const span = h("span", { class: "hero-word", "data-word": "" }, word);
    span.style.setProperty("--index", String(index));
    heading.append(span, index < words.length - 1 ? " " : "");
  });
  return h("section", { "data-chapter": "opening", class: "chapter chapter-opening night", "aria-labelledby": "opening-title" },
    h("div", { class: "light-pool", "aria-hidden": "true" }),
    openingArcs(),
    h("div", { class: "opening-copy" },
      heading,
      h("p", { class: "opening-line" }, HERO_LINE),
      h("div", { class: "actions" },
        h("a", { class: "button", href: "/#about" }, "Begin the story", icon("arrow")),
        h("a", { class: "button button-quiet", href: "/#product" }, "See Vireo Pace"))));
}
