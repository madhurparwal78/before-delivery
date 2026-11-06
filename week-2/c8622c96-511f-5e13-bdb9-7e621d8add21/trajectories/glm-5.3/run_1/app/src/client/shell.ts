// The shell: top bar with the product name, the signed-in person and their
// sections, the sign-out button, and the screen container.
import { el, clear, SECTION_ROUTES, SECTION_LABELS } from "./dom.js";

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  newsroom: { slug: string; name: string; home_zone: string } | null;
  contributor_handle: string | null;
}

export function renderShell(root: HTMLElement, user: User, pathname: string, onSignOut: () => void): { main: HTMLElement } {
  clear(root);
  const home = user.newsroom ? user.newsroom.name : "Saltprint Picture Co-operative";
  const links = SECTION_ROUTES[user.role] ?? ["/sheet"];
  const nav = el("nav", { id: "desk-sections", "aria-label": "Desk sections", role: "navigation" });
  for (const route of links) {
    const active = route === pathname || (pathname === "/" && route === links[0]);
    nav.append(el("a", { href: route, class: `section-link${active ? " active" : ""}`, "aria-current": active ? "page" : null, text: SECTION_LABELS[route] }));
  }
  const bar = el(
    "header",
    { class: "topbar" },
    el("div", { class: "topbar-left" }, el("span", { class: "product-name", text: "Saltprint Desk" })),
    el("div", { class: "topbar-mid" }, nav),
    el(
      "div",
      { class: "topbar-right" },
      el("span", { class: "who", text: `${user.name} · ${home}` }),
      el("button", { class: "btn ghost", type: "button", text: "Sign out", "aria-label": "Sign out" }),
    ),
  );
  (bar.querySelector("button") as HTMLButtonElement).addEventListener("click", onSignOut);
  const main = el("main", { id: "main", class: "main", tabindex: "-1" });
  root.append(bar, main);
  return { main };
}
