import { api, loadMe, me, el } from "./api.js";
import { renderProgramme } from "./pages/programme.js";
import { renderSignIn, renderRegister } from "./pages/auth.js";
import { renderTickets } from "./pages/tickets.js";
import { renderOrder } from "./pages/order.js";
import { renderStudio } from "./pages/studio.js";
import { renderCurate } from "./pages/curate.js";
import { renderBoxOffice } from "./pages/boxoffice.js";
import { renderFinance } from "./pages/finance.js";
import { renderGroup } from "./pages/group.js";
import { renderAdmin } from "./pages/admin.js";
import { openCheckout } from "./pages/checkout.js";

type Render = (root: HTMLElement) => Promise<void> | void;

const routes: Array<{ pattern: RegExp; render: Render }> = [
  { pattern: /^\/$/, render: renderProgramme },
  { pattern: /^\/signin$/, render: renderSignIn },
  { pattern: /^\/register$/, render: renderRegister },
  { pattern: /^\/tickets$/, render: renderTickets },
  { pattern: /^\/orders\/([^/]+)$/, render: (root) => renderOrder(root, window.location.pathname.split("/")[2]) },
  { pattern: /^\/studio$/, render: renderStudio },
  { pattern: /^\/curate$/, render: renderCurate },
  { pattern: /^\/box-office$/, render: renderBoxOffice },
  { pattern: /^\/finance$/, render: renderFinance },
  { pattern: /^\/group$/, render: renderGroup },
  { pattern: /^\/admin$/, render: renderAdmin },
];

export async function navigate(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  renderNav();
  const path = window.location.pathname;
  if (path.startsWith("/orders/") && new URLSearchParams(window.location.search).get("checkout")) {
    await renderProgramme(root);
    return;
  }
  for (const route of routes) {
    if (route.pattern.test(path)) {
      root.replaceChildren();
      await route.render(root);
      return;
    }
  }
  root.replaceChildren();
  root.append(el("h1", { text: "Not found" }));
}

export function goto(path: string, params?: Record<string, string>): void {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  if (url.search === window.location.search && url.pathname === window.location.pathname) return;
  window.history.pushState({}, "", url.toString());
  void navigate();
}

function renderNav(): void {
  const nav = document.getElementById("main-nav");
  if (!nav) return;
  nav.replaceChildren();
  nav.append(el("a", { class: "brand", href: "/", text: "Kerf Frequencies" }));
  const links: Array<[string, string]> = [["/", "Programme"], ["/#gallery", "Gallery"], ["/#tickets", "Tickets"]];
  for (const [href, label] of links) {
    nav.append(el("a", { href, text: label }));
  }
  nav.append(el("a", { href: "/tickets", text: "My tickets" }));
  if (me) {
    if (me.role === "artist") nav.append(el("a", { href: "/studio", text: "Studio" }));
    if (me.role === "curator") nav.append(el("a", { href: "/curate", text: "Curate" }));
    if (me.role === "box_office") nav.append(el("a", { href: "/box-office", text: "Box office" }));
    if (me.role === "finance") nav.append(el("a", { href: "/finance", text: "Finance" }));
    if (me.role === "group_booker") nav.append(el("a", { href: "/group", text: "Group" }));
    if (me.role === "admin") nav.append(el("a", { href: "/admin", text: "Admin" }));
    const btn = el("button", { text: "Sign out" });
    btn.addEventListener("click", async () => {
      await api("/api/auth/signout", { method: "POST" }, "none");
      window.location.href = "/";
    });
    nav.append(btn);
  } else {
    nav.append(el("a", { href: "/signin", text: "Sign in" }));
  }
}

async function boot(): Promise<void> {
  await loadMe();
  window.addEventListener("popstate", () => void navigate());
  await navigate();
  // The checkout step travels in the URL: reopening restores the same step.
  const params = new URLSearchParams(window.location.search);
  const step = params.get("checkout");
  if (step === "tickets" || step === "details" || step === "review") {
    void openCheckout(step);
  }
  // Ground changes: the sticky nav takes on the passing section's pair.
  const sections = Array.from(document.querySelectorAll<HTMLElement>("section[data-ground]"));
  window.addEventListener("scroll", () => {
    const mid = window.innerHeight / 2;
    let current = "";
    for (const s of sections) {
      const rect = s.getBoundingClientRect();
      if (rect.top <= mid && rect.bottom >= mid) current = s.dataset.ground ?? "";
    }
    const nav = document.getElementById("main-nav");
    if (nav) {
      nav.classList.remove("on-paper", "on-blue", "on-vermilion");
      if (current === "paper") nav.classList.add("on-paper");
      if (current === "blue") nav.classList.add("on-blue");
      if (current === "vermilion") nav.classList.add("on-vermilion");
    }
    document.dispatchEvent(new CustomEvent("kerf:scroll", { detail: window.scrollY }));
  }, { passive: true });
}

void boot();
