import { h } from "../dom.js";
import { currentUser, homePath } from "../session.js";

/** Identical for a missing id and for an id the viewer may not see. */
export function notFoundView(root: HTMLElement): void {
  const user = currentUser();
  const home = user ? homePath(user.role) : "/";
  root.append(
    h(
      "section",
      { class: "box notfound", "aria-labelledby": "notfound-title" },
      h("h1", { id: "notfound-title" }, "Not found"),
      h("p", null, "There is nothing here to show you. The link may be mistyped, or the record may belong to someone else."),
      h("a", { href: home, class: "button" }, home === "/counter" ? "Back to the Counter" : "Back to the Catalogue"),
    ),
  );
}
