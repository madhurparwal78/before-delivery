// The top bar: the wordmark, the role's navigation and Sign out, with the
// navigation behind a Menu button in the narrow band (DP-70).
import { h } from "./dom.js";
import type { SessionUser } from "../state.js";
import { api } from "../api.js";
import { navigate } from "../router.js";

const NAV_BY_ROLE: Record<string, { label: string; href: string }[]> = {
  owner: [
    { label: "Register", href: "/register" },
    { label: "Price lists", href: "/price-lists" },
    { label: "Schools", href: "/schools" },
  ],
  tech: [{ label: "Register", href: "/register" }],
  parent: [{ label: "My family", href: "/family" }],
  director: [{ label: "Roster", href: "/roster" }],
};

export function buildTopBar(user: SessionUser): HTMLElement {
  const bar = h("header", { class: "topbar" });
  const wordmark = h("a", { class: "wordmark", href: roleHome(user), text: "Keel & Bell" });
  bar.appendChild(wordmark);

  const links = NAV_BY_ROLE[user.role] ?? [];
  const nav = h("nav", { class: "topnav", "aria-label": "Main" });
  for (const link of links) {
    nav.appendChild(h("a", { class: "navlink", href: link.href, text: link.label }));
  }
  const signOut = h("button", {
    class: "btn btn-ghost navlink",
    text: "Sign out",
    onclick: async () => {
      await api("DELETE", "/api/session").catch(() => undefined);
      navigate("/");
    },
  });

  let expanded = false;
  const menuButton = h("button", {
    class: "btn btn-ghost menu-button",
    "aria-expanded": "false",
    "aria-controls": "topbar-menu",
    text: "Menu",
    onclick: () => {
      expanded = !expanded;
      menuButton.setAttribute("aria-expanded", String(expanded));
      document.body.classList.toggle("menu-open", expanded);
      if (expanded) {
        const first = menuPanel.querySelector<HTMLElement>("a, button");
        first?.focus();
      } else {
        menuButton.focus();
      }
    },
  });

  const menuPanel = h("div", { class: "topnav-panel", id: "topbar-menu" });
  menuPanel.appendChild(nav);
  menuPanel.appendChild(signOut);
  menuPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      expanded = false;
      menuButton.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-open");
      menuButton.focus();
    }
  });
  menuPanel.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("a")) {
      expanded = false;
      menuButton.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-open");
    }
  });

  bar.appendChild(menuButton);
  bar.appendChild(menuPanel);
  return bar;
}

export function roleHome(user: SessionUser): string {
  if (user.role === "owner" || user.role === "tech") return "/register";
  if (user.role === "parent") return "/family";
  return "/roster";
}
