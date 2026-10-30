// The browser app: the header band, the router and the screens.

import type { Role, User } from "../shared/api.js";
import { ApiFailure, request, whenSignedOut } from "./api.js";
import { h, icon } from "./dom.js";
import { navigate, onNavigate } from "./nav.js";
import { currentUser, homePath, isStaff, loadLibrary, setUser } from "./session.js";
import "./styles.css";
import { catalogueView } from "./views/catalogue.js";
import { counterView } from "./views/counter.js";
import { itemView } from "./views/item.js";
import { ledgerView } from "./views/ledger.js";
import { loanView } from "./views/loan.js";
import { myLoansView } from "./views/myloans.js";
import { notFoundView } from "./views/notfound.js";
import { signInView } from "./views/signin.js";

type View = (root: HTMLElement, param: string) => (() => void) | void;

const SCREENS: { path: RegExp; view: View; roles: readonly Role[] }[] = [
  { path: /^\/catalogue$/, view: catalogueView, roles: ["member", "volunteer", "founder"] },
  { path: /^\/items\/([^/]+)$/, view: itemView, roles: ["member", "volunteer", "founder"] },
  { path: /^\/my-loans$/, view: myLoansView, roles: ["member"] },
  { path: /^\/loans\/([^/]+)$/, view: loanView, roles: ["member", "volunteer", "founder"] },
  { path: /^\/counter$/, view: counterView, roles: ["volunteer", "founder"] },
  { path: /^\/ledger$/, view: ledgerView, roles: ["founder"] },
];

const root = document.getElementById("app") ?? document.body;
const pageTop = h("span", { id: "page-top", tabindex: "-1", class: "page-top" });
const header = h("header", { class: "masthead" });
const main = h("main", { id: "main", tabindex: "-1", class: "page" });
root.append(pageTop, h("a", { class: "skip-link", href: "#main" }, "Skip to content"), header, main);

document.querySelector(".skip-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  main.focus();
});

function navLinks(user: User, path: string): HTMLLIElement[] {
  const links: [string, string][] = [["/catalogue", "Catalogue"]];
  if (user.role === "member") links.push(["/my-loans", "My loans"]);
  if (isStaff(user.role)) links.push(["/counter", "Counter"]);
  if (user.role === "founder") links.push(["/ledger", "Ledger"]);
  return links.map(([href, text]) =>
    h("li", null, h("a", { href, class: "nav__link", "aria-current": path === href || path.startsWith(`${href}/`) ? "page" : null }, text)),
  );
}

function renderHeader(user: User | null, path: string): void {
  const wordmark = user
    ? h("a", { href: homePath(user.role), class: "wordmark" }, "COMMON SHED CO.")
    : h("span", { class: "wordmark" }, "COMMON SHED CO.");
  if (!user) {
    header.replaceChildren(h("div", { class: "masthead__bar" }, wordmark));
    return;
  }
  const nav = h("nav", { id: "main-nav", class: "nav", "aria-label": "Main" }, h("ul", { class: "nav__list" }, navLinks(user, path)));
  const menu = h(
    "button",
    { type: "button", class: "button menu-button", "aria-expanded": "false", "aria-controls": "main-nav" },
    icon("menu"),
    h("span", null, "Menu"),
  );
  const setOpen = (open: boolean) => {
    menu.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  };
  menu.addEventListener("click", () => setOpen(menu.getAttribute("aria-expanded") !== "true"));
  const bar = h("div", { class: "masthead__bar" });
  bar.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      menu.focus();
    }
  });
  const signOut = h(
    "button",
    {
      type: "button",
      class: "button signout",
      onclick: async () => {
        await request("DELETE", "/api/session").catch((error: unknown) => {
          if (!(error instanceof ApiFailure)) throw error;
        });
        setUser(null);
        navigate("/");
      },
    },
    icon("logOut"),
    h("span", null, "Sign out"),
  );
  bar.append(wordmark, menu, nav, h("div", { class: "masthead__user" }, h("span", { class: "label masthead__who" }, `${user.name} · ${user.role}`), signOut));
  header.replaceChildren(bar);
}

let cleanup: (() => void) | void;

async function render(): Promise<void> {
  if (cleanup) cleanup();
  cleanup = undefined;
  const path = location.pathname;
  const user = currentUser();
  if (path === "/" && user) return navigate(homePath(user.role), true);
  if (path !== "/" && !user) return navigate("/", true);
  if (user) await loadLibrary();
  renderHeader(user, path);
  main.replaceChildren();
  window.scrollTo(0, 0);
  pageTop.focus({ preventScroll: true });
  if (!user) {
    signInView(main);
    document.title = "Sign in · Shedline";
    return;
  }
  for (const screen of SCREENS) {
    const match = screen.path.exec(path);
    if (!match) continue;
    if (!screen.roles.includes(user.role)) break;
    cleanup = screen.view(main, decodeURIComponent(match[1] ?? ""));
    document.title = `${main.querySelector("h1")?.textContent ?? "Shedline"} · Shedline`;
    return;
  }
  notFoundView(main);
  document.title = "Not found · Shedline";
}

whenSignedOut(() => {
  setUser(null);
  navigate("/", true);
});
onNavigate(() => void render());

try {
  const { user } = await request<{ user: User }>("GET", "/api/session");
  setUser(user);
} catch (error) {
  if (!(error instanceof ApiFailure)) throw error;
}
void render();
