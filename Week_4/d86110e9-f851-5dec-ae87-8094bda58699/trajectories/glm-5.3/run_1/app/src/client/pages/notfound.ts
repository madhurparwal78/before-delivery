// The not-found page shown for any unknown address.

import { h } from "../runtime";
import type { VNode } from "preact";
import { navigate } from "../runtime";

export function NotFound(): VNode {
  return h("div", { class: "auth-page" },
    h("div", { class: "dark-panel auth-panel notfound-panel" },
      h("h1", { class: "auth-heading" }, "We couldn't find that page"),
      h("p", { class: "notfound-line" }, "It may have moved, or you may not have access to it."),
      h("a", { class: "link-action", href: "/", onClick: (e: Event) => { e.preventDefault(); navigate("/"); } }, "Back to start")));
}
