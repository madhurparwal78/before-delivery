import { el } from "../util.js";
/** The not-found screen for any unknown path. */
export function renderNotFound(page, me) {
    const home = me.role === "coordinator" ? "/coordinator" : me.role === "volunteer" ? "/breakdown" : "/";
    page.append(el("h1", { text: "Page not found" }), el("p", {}, el("a", { href: home, "data-nav": true, text: "Back to your home" })));
}
