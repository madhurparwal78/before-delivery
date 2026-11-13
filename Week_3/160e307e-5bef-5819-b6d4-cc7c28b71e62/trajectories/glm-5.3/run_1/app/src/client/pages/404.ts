import { el, mountOutageBanner } from "../lib/app.js";

mountOutageBanner();
const root = document.getElementById("root");
if (root !== null) {
  const page = el("div", { class: "page" });
  page.append(
    el("h1", {}, "Page not found"),
    el("a", { class: "btn", href: "/" }, "Home")
  );
  root.appendChild(page);
}
