// The public home poster: full-bleed yellow, cropped meter, enormous headline.
import { h } from "../dom.js";
import { meter } from "../art.js";

export function mount({ container }) {
  container.replaceChildren(h("section", { class: "hero field-yellow" },
    h("span", { class: "hero-wordmark", text: "Hourproof" }),
    meter("hero-meter"),
    h("h1", { class: "hero-title" }, h("span", { text: "EVERY" }), " ", h("span", { text: "HOUR" })),
    h("p", { class: "hero-line", text: "A year of clean power means nothing at 3am." }),
    h("a", { class: "button hero-open", href: "/sign-in", text: "OPEN THE DESK" })));
  return { unmount() {} };
}
