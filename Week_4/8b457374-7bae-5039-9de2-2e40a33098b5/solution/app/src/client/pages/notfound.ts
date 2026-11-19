import { h, s } from "../dom.js";
import { title, type Page } from "../page.js";

// Any unknown page (brief: Feedback states › Not found).

export const notFoundPage: Page = (main) => {
  title("Not found");
  main.append(h("section", { class: "not-found" },
    s("svg", { class: "empty-dot", viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" },
      s("circle", { cx: 50, cy: 50, r: 46, fill: "none", stroke: "currentColor", "stroke-width": 3 })),
    h("h1", {}, "This page did not go to press."),
    h("p", {}, h("a", { href: "/", class: "btn" }, "Back to the home page"))));
};
