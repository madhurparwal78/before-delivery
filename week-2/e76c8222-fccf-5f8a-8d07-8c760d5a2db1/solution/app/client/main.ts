// Boots the client: the shell (top bar, service banner), the router and the screens.
import type { SystemStatus, User } from "../shared/api.js";
import type { Role } from "../shared/domain.js";
import { call, get } from "./api.js";
import { connectShell, LANDING, type Screen } from "./app.js";
import { h, replace, say, statusRegion } from "./dom.js";
import { boardScreen } from "./screens/board.js";
import { billingScreen } from "./screens/billing.js";
import { invoicesScreen } from "./screens/invoices.js";
import { meScreen } from "./screens/me.js";
import { offerScreen } from "./screens/offer.js";
import { preferencesScreen } from "./screens/preferences.js";
import { requestDetailScreen } from "./screens/request-detail.js";
import { newRequestScreen } from "./screens/request-new.js";
import { requestsScreen } from "./screens/requests.js";
import { signinScreen } from "./screens/signin.js";

interface RouteDef {
  pattern: RegExp;
  roles: readonly Role[] | "public" | "signed-out";
  render: (screen: Screen) => void | Promise<void>;
  board?: boolean;
}

const ROUTES: RouteDef[] = [
  { pattern: /^\/signin$/, roles: "signed-out", render: signinScreen },
  { pattern: /^\/board$/, roles: ["coordinator"], render: boardScreen, board: true },
  { pattern: /^\/requests$/, roles: ["requester"], render: requestsScreen },
  { pattern: /^\/requests\/new$/, roles: ["requester"], render: newRequestScreen },
  { pattern: /^\/requests\/(?<id>[^/]+)$/, roles: ["requester", "coordinator", "billing"], render: requestDetailScreen },
  { pattern: /^\/invoices$/, roles: ["requester", "billing"], render: invoicesScreen },
  { pattern: /^\/me$/, roles: ["interpreter"], render: meScreen },
  { pattern: /^\/offers\/(?<token>[^/]+)$/, roles: "public", render: offerScreen },
  { pattern: /^\/preferences$/, roles: ["consumer"], render: preferencesScreen },
  { pattern: /^\/billing$/, roles: ["billing"], render: billingScreen },
];

const NAV: Record<Role, [string, string][]> = {
  coordinator: [["/board", "Board"]],
  requester: [
    ["/requests", "Requests"],
    ["/invoices", "Invoices"],
  ],
  interpreter: [["/me", "My work"]],
  consumer: [["/preferences", "Preferences"]],
  billing: [
    ["/billing", "Billing"],
    ["/invoices", "Invoices"],
  ],
};

let user: User | null = null;
let leaving: (() => void)[] = [];

const skipSlot = h("div", { class: "skip-slot" });
const header = h("header", { class: "topbar" });
const banner = statusRegion("Service status", "banner");
const main = h("main", { id: "main", class: "page" });
document.body.replaceChildren(skipSlot, header, banner, main);

function renderHeader(path: string): void {
  const brand = h("a", { class: "brand", href: user ? LANDING[user.role] : "/signin" }, h("span", { class: "brand-name" }, "Seatweaver"), h("span", { class: "brand-org" }, "Fernhollow Access"));
  if (!user) {
    replace(header, brand);
    return;
  }
  const links = NAV[user.role].map(([href, label]) =>
    h("li", {}, h("a", { href, "aria-current": path === href || path.startsWith(`${href}/`) ? "page" : false }, label)),
  );
  const signOut = h("button", { type: "button", class: "button quiet" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await call("DELETE", "/api/session");
    user = null;
    go("/signin");
  });
  replace(
    header,
    brand,
    h("nav", { "aria-label": "Main" }, h("ul", {}, links)),
    h("div", { class: "who" }, h("span", { class: "who-name" }, user.name), signOut),
  );
}

const BANNER = {
  mail: "Mail is unreachable. Emails are queued and send automatically when it returns.",
  killbill: "Billing is unreachable. Approvals, charged cancellations and invoices are paused.",
};

async function watchServices(): Promise<void> {
  const status = await get<SystemStatus>("/api/system/status");
  const lines = status.ok ? [status.data.mail === "down" ? BANNER.mail : "", status.data.killbill === "down" ? BANNER.killbill : ""].filter(Boolean) : [];
  say(banner, lines.join(" "));
  banner.classList.toggle("is-down", lines.length > 0);
}

async function render(path: string, flash: string | null): Promise<void> {
  for (const cleanup of leaving) cleanup();
  leaving = [];
  const found = ROUTES.map((r) => ({ r, m: r.pattern.exec(path) })).find((x) => x.m);
  if (!found) {
    go(user ? LANDING[user.role] : "/signin", undefined, true);
    return;
  }
  const { r, m } = found;
  if (r.roles === "signed-out" && user) return go(LANDING[user.role], undefined, true);
  if (Array.isArray(r.roles)) {
    if (!user) return go("/signin", undefined, true);
    if (!r.roles.includes(user.role)) return go(LANDING[user.role], undefined, true);
  }
  document.body.classList.toggle("board-mode", r.board === true);
  replace(skipSlot);
  if (r.board) {
    const skip = h("a", { class: "skip-link", href: "#board-requests" }, "Skip to requests");
    skip.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById("board-requests")?.focus();
    });
    skipSlot.append(skip);
  }
  renderHeader(path);
  main.replaceChildren();
  main.className = r.board ? "page board-page" : "page";
  await r.render({ main, user, params: { ...m?.groups }, flash, onLeave: (cleanup) => leaving.push(cleanup) });
}

function go(path: string, flash?: string, replaceState = false): void {
  if (replaceState) history.replaceState({ flash: flash ?? null }, "", path);
  else history.pushState({ flash: flash ?? null }, "", path);
  void render(path, flash ?? null);
}

connectShell({
  navigate: (path, flash) => go(path, flash),
  signedIn: (next) => {
    user = next;
    go(LANDING[next.role], undefined, true);
  },
});

window.addEventListener("popstate", () => void render(location.pathname, null));

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  if (!link || link.hasAttribute("download") || link.target || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const href = link.getAttribute("href") ?? "";
  if (!href.startsWith("/") || href.startsWith("/api/")) return;
  event.preventDefault();
  go(href);
});

const me = await get<{ user: User }>("/api/me");
user = me.ok ? me.data.user : null;
void watchServices();
setInterval(() => void watchServices(), 30_000);
if (location.pathname === "/") go(user ? LANDING[user.role] : "/signin", undefined, true);
else void render(location.pathname, null);
