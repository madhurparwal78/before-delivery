import { el, mountOutageBanner } from "../lib/app.js";

mountOutageBanner();
const root = document.getElementById("root");
if (root !== null) {
  const page = el("div", { class: "page" });
  const h1 = el("h1", {}, "This link has expired");
  const home = el("a", { class: "btn", href: "/" }, "Home");
  home.setAttribute("aria-label", "Home");
  page.append(h1, home);
  root.appendChild(page);
}
