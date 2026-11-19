import { Car, Flag, Trophy, Users } from "lucide";
import { get } from "./api";
import { h, icon, replace } from "./dom";

const OUTAGE_COPY = "Replay storage is unavailable. Runs are held and will verify when it returns.";
const STATUS_POLL_MS = 5000;
const NARROW = matchMedia("(max-width: 767px)");

const LINKS = [
  { href: "/garage", label: "Garage", node: Car },
  { href: "/boards", label: "Leaderboards", node: Flag },
  { href: "/championship", label: "Championship", node: Trophy },
  { href: "/lobby/new", label: "Online lobby", node: Users },
];

let menuButton: HTMLButtonElement | null = null;
let menuPanel: HTMLElement | null = null;

export function collapseMenu(): void {
  if (!menuButton || !menuPanel) return;
  menuButton.setAttribute("aria-expanded", "false");
  menuPanel.removeAttribute("data-open");
}

function expandMenu(): void {
  if (!menuButton || !menuPanel) return;
  menuButton.setAttribute("aria-expanded", "true");
  menuPanel.setAttribute("data-open", "");
  menuPanel.querySelector("a")?.focus();
}

NARROW.addEventListener("change", collapseMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuButton?.getAttribute("aria-expanded") === "true") {
    collapseMenu();
    menuButton.focus();
  }
});

function section(path: string): string {
  if (path.startsWith("/garage") || path.startsWith("/race") || path.startsWith("/runs")) return "/garage";
  if (path.startsWith("/boards")) return "/boards";
  if (path.startsWith("/championship")) return "/championship";
  return path.startsWith("/lobby") ? "/lobby/new" : "";
}

function header(full: boolean): HTMLElement {
  const brand = h("a", { href: full ? "/garage" : "/", class: "brand" },
    h("span", { class: "brand-mark", "aria-hidden": "true" }, "KL"), h("span", { class: "brand-name" }, "Kerbline"));
  if (!full) {
    menuButton = null;
    menuPanel = null;
    return h("header", { class: "masthead" }, brand);
  }
  const current = section(location.pathname);
  menuPanel = h("ul", { id: "site-pages", class: "nav-links" },
    ...LINKS.map((link) => h("li", null, h("a", {
      href: link.href, class: "nav-link", "aria-current": link.href === current ? "page" : null,
    }, icon(link.node, 16), link.label))));
  menuButton = h("button", {
    type: "button", class: "menu-button", "aria-expanded": "false", "aria-controls": "site-pages",
    onclick: () => (menuButton?.getAttribute("aria-expanded") === "true" ? collapseMenu() : expandMenu()),
  }, "Menu");
  return h("header", { class: "masthead" }, brand, h("nav", { class: "site-nav", "aria-label": "Pages" }, menuButton, menuPanel));
}

// Lays out a page: masthead, the numbered stage gutter and the main column. Returns main.
export function renderShell(full: boolean, stages: readonly string[]): HTMLElement {
  const app = document.getElementById("app")!;
  const main = h("main", { id: "main", class: "page-main", tabindex: "-1" });
  const gutter = h("ol", { class: "stage-gutter", "aria-label": "Page stages" },
    ...stages.map((label, i) => h("li", { class: "stage" },
      h("span", { class: "stage-no" }, String(i + 1).padStart(2, "0")), h("span", { class: "stage-label" }, label))));
  replace(app, h("div", { id: "outage-slot" }), header(full), h("div", { class: "page" }, gutter, main));
  paintBanner();
  return main;
}

let storageDown = false;

function paintBanner(): void {
  const slot = document.getElementById("outage-slot");
  if (!slot) return;
  const shown = slot.querySelector("[role=alert]");
  if (storageDown && !shown) slot.append(h("div", { role: "alert", class: "banner" }, OUTAGE_COPY));
  if (!storageDown && shown) shown.remove();
}


async function pollStatus(): Promise<void> {
  const result = await get<{ replayStorage: string }>("/v1/status").catch(() => null);
  if (!result || result.status !== 200) return;
  storageDown = result.data.replayStorage === "unavailable";
  paintBanner();
}

export function startStatusWatch(): void {
  void pollStatus();
  window.setInterval(() => void pollStatus(), STATUS_POLL_MS);
}
