/** Shared app state, header and the tiny router. */

import { get, post, onSignedOut } from "./api.ts";
import { el, clear, esc, openDialog, busy, announce } from "./ui.ts";
import { amount } from "./format.ts";
import { renderHome } from "./pages/home.ts";
import { renderSearch } from "./pages/search.ts";
import { renderProduct, renderOffers } from "./pages/product.ts";
import { renderCompare } from "./pages/compare.ts";
import { renderCart } from "./pages/cart.ts";
import { renderWishlist, renderShared } from "./pages/wishlist.ts";
import { renderOrders, renderOrderDetail, renderPlaced } from "./pages/orders.ts";
import { renderAccount } from "./pages/account.ts";
import { renderSignin, renderSigninCode, renderSignup, renderSignupCode, renderForgot } from "./pages/auth.ts";
import { renderCheckout } from "./pages/checkout.ts";
import { renderSellerListings, renderSellerListingForm, renderSellerListingEdit } from "./pages/seller_listings.ts";
import { renderSellerStock } from "./pages/seller_stock.ts";
import { renderSellerShipments } from "./pages/seller_shipments.ts";
import { renderSellerReturns } from "./pages/seller_returns.ts";
import { renderSellerStatement } from "./pages/seller_statement.ts";
import { renderSupport, renderSupportOrder } from "./pages/support.ts";
import { magneticCursor } from "./fx.ts";

export interface Account {
  id: string;
  name: string;
  first_name: string;
  role: string;
}

export interface App {
  account: Account | null;
  cartCount: number;
  pincode: string;
  compare: string[];
}

export const state: App = {
  account: null,
  cartCount: 0,
  pincode: "560034",
  compare: [],
};

export const PINCODE_KEY = "chauraha_pincode";
export const GUEST_CART_KEY = "chauraha_guest_cart";
export const CHECKOUT_KEY = "chauraha_checkout";
export const COMPARE_KEY = "chauraha_compare";

export function loadLocal(): void {
  const pin = window.localStorage.getItem(PINCODE_KEY);
  if (pin && /^\d{6}$/.test(pin)) state.pincode = pin;
  const compare = window.localStorage.getItem(COMPARE_KEY);
  if (compare) {
    try { state.compare = JSON.parse(compare) as string[]; } catch { state.compare = []; }
  }
}

export function saveCompare(): void {
  window.localStorage.setItem(COMPARE_KEY, JSON.stringify(state.compare));
}

export function signInTarget(): string {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return window.location.pathname + window.location.search;
}

export function signinLink(): string {
  return `/signin?next=${encodeURIComponent(signInTarget())}`;
}

export async function refreshMe(): Promise<void> {
  try {
    const me = await get<{ account: Account; balance_paise: number }>("/api/me", { silentAuth: true });
    state.account = me.account;
  } catch {
    state.account = null;
  }
}

export async function refreshCartCount(): Promise<void> {
  if (!state.account || state.account.role !== "shopper") {
    const guest = guestCart();
    state.cartCount = guest.reduce((a, l) => a + l.quantity, 0);
    return;
  }
  try {
    const cart = await get<{ lines: Array<{ quantity: number; selected: boolean }> }>("/api/cart");
    state.cartCount = cart.lines.filter((l) => l.selected).reduce((a, l) => a + l.quantity, 0);
  } catch {
    state.cartCount = 0;
  }
}

export interface GuestLine { listing_id: string; quantity: number; title?: string }

export function guestCart(): GuestLine[] {
  try {
    const raw = window.localStorage.getItem(GUEST_CART_KEY);
    return raw ? JSON.parse(raw) as GuestLine[] : [];
  } catch {
    return [];
  }
}

export function setGuestCart(lines: GuestLine[]): void {
  window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(lines));
}

export async function signOut(): Promise<void> {
  try { await post("/api/auth/signout", {}); } catch { /* already signed out */ }
  state.account = null;
  state.cartCount = 0;
  navigate("/");
}

/** The one not-found panel. */
export function notFoundPanel(): HTMLElement {
  const panel = el("main", { class: "panel-black notfound", role: "main" });
  const h1 = el("h1", { text: "nothing here. wrong turn at the chauraha." });
  const link = el("a", { class: "btn btn-primary", href: "/", text: "back to the bazaar" });
  panel.append(h1, link);
  return panel;
}

interface Route {
  pattern: RegExp;
  page: (params: Record<string, string>, query: URLSearchParams) => Promise<HTMLElement> | HTMLElement;
}

const routes: Route[] = [
  { pattern: /^\/$/, page: () => renderHome() },
  { pattern: /^\/search$/, page: (_p, q) => renderSearch(q) },
  { pattern: /^\/p\/([^/]+)\/offers$/, page: (p, q) => renderOffers(p[0], q) },
  { pattern: /^\/p\/([^/]+)$/, page: (p, q) => renderProduct(p[0], q) },
  { pattern: /^\/compare$/, page: (_p, q) => renderCompare(q) },
  { pattern: /^\/cart$/, page: () => renderCart() },
  { pattern: /^\/wishlist$/, page: () => renderWishlist() },
  { pattern: /^\/s\/([^/]+)$/, page: (p) => renderShared(p[0]) },
  { pattern: /^\/orders$/, page: () => renderOrders() },
  { pattern: /^\/orders\/([^/]+)\/placed$/, page: (p) => renderPlaced(p[0]) },
  { pattern: /^\/orders\/([^/]+)$/, page: (p) => renderOrderDetail(p[0]) },
  { pattern: /^\/account$/, page: () => renderAccount() },
  { pattern: /^\/signin$/, page: () => renderSignin() },
  { pattern: /^\/signin\/code$/, page: () => renderSigninCode() },
  { pattern: /^\/signup$/, page: () => renderSignup() },
  { pattern: /^\/signup\/code$/, page: () => renderSignupCode() },
  { pattern: /^\/forgot$/, page: () => renderForgot() },
  { pattern: /^\/checkout\/address$/, page: () => renderCheckout("address") },
  { pattern: /^\/checkout\/payment$/, page: () => renderCheckout("payment") },
  { pattern: /^\/checkout\/review$/, page: () => renderCheckout("review") },
  { pattern: /^\/seller\/listings$/, page: () => renderSellerListings() },
  { pattern: /^\/seller\/listings\/new$/, page: () => renderSellerListingForm() },
  { pattern: /^\/seller\/listings\/([^/]+)$/, page: (p) => renderSellerListingEdit(p[0]) },
  { pattern: /^\/seller\/stock$/, page: () => renderSellerStock() },
  { pattern: /^\/seller\/shipments$/, page: () => renderSellerShipments() },
  { pattern: /^\/seller\/returns$/, page: () => renderSellerReturns() },
  { pattern: /^\/seller\/statement$/, page: () => renderSellerStatement() },
  { pattern: /^\/support$/, page: () => renderSupport() },
  { pattern: /^\/support\/orders\/([^/]+)$/, page: (p) => renderSupportOrder(p[0]) },
];

export async function navigate(path: string, replace = false): Promise<void> {
  if (replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  await route();
}

export async function route(): Promise<void> {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const app = document.getElementById("app");
  if (!app) return;
  clear(app);
  app.setAttribute("aria-busy", "true");
  let page: HTMLElement;
  const match = routes.find((r) => r.pattern.exec(path));
  if (!match) {
    page = notFoundPanel();
  } else {
    const params = match.pattern.exec(path)!.slice(1);
    const named: Record<string, string> = {};
    params.forEach((p, i) => { named[String(i)] = p; });
    try {
      page = await match.page(named, query);
    } catch {
      page = notFoundPanel();
    }
  }
  clear(app);
  app.append(page);
  app.setAttribute("aria-busy", "false");
  renderHeader();
  window.scrollTo(0, window.scrollY);
}

export function renderHeader(): void {
  const old = document.querySelector(".site-header");
  if (old) old.remove();
  const header = el("header", { class: "site-header" });
  const brand = el("a", { class: "brand", href: "/", text: "chauraha" });

  const searchForm = el("form", { class: "header-search", role: "search" });
  const searchBox = el("input", {
    type: "search", "aria-label": "Search Chauraha", placeholder: "search the bazaar",
    name: "q", value: "",
  });
  searchBox.setAttribute("aria-keyshortcuts", "/");
  const searchBtn = el("button", { class: "btn btn-yellow", type: "submit", text: "Search" });
  searchForm.append(searchBox, searchBtn);
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = (searchForm.elements.namedItem("q") as HTMLInputElement).value.trim();
    void navigate(`/search?q=${encodeURIComponent(q)}`);
  });

  const deliverBtn = el("button", { class: "btn btn-ghost", "aria-haspopup": "dialog", text: state.pincode ? `deliver to ${state.pincode}` : "set pincode" });
  deliverBtn.addEventListener("click", () => openPincodeDialog(deliverBtn));

  const spacer = el("div", { style: "flex:1" });
  const cartLink = el("a", { class: "btn btn-ghost", href: "/cart", "aria-label": "Cart" });
  cartLink.append(document.createTextNode("cart"));
  if (state.cartCount > 0) {
    const badge = el("span", { class: "count-badge", "aria-hidden": "true", text: ` ${state.cartCount}` });
    cartLink.append(badge);
  }
  let accountControl: HTMLElement;
  if (state.account) {
    const btn = el("button", { class: "btn btn-ghost", text: "Account" });
    btn.addEventListener("click", () => {
      const home = state.account?.role === "seller" ? "/seller/shipments"
        : state.account?.role === "support" ? "/support" : "/account";
      void navigate(home);
    });
    accountControl = btn;
  } else {
    accountControl = el("a", { class: "btn btn-ghost", href: signinLink(), text: "Sign in" });
  }
  header.append(brand, searchForm, deliverBtn, spacer, cartLink, accountControl);
  const app = document.getElementById("app");
  app?.before(header);
  document.removeEventListener("keydown", globalSlash);
  document.addEventListener("keydown", globalSlash);
}

function globalSlash(e: KeyboardEvent): void {
  if (e.key !== "/") return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
  e.preventDefault();
  document.querySelector<HTMLInputElement>("[aria-label='Search Chauraha']")?.focus();
}

function openPincodeDialog(opener: HTMLElement): void {
  const field = el("label", { class: "field" });
  const labelText = el("span", { class: "label-text", text: "Pincode" });
  const input = el("input", { type: "text", name: "pincode", value: state.pincode, inputmode: "numeric", maxlength: "6" });
  field.append(labelText, input);
  const checkBtn = el("button", { class: "btn btn-primary", type: "button", text: "Check pincode" });
  const note = el("p", { class: "field-error", role: "status" });
  const dlg = el("dialog", { "aria-label": "Delivery pincode" });
  const h2 = el("h2", { text: "Delivery pincode" });
  dlg.append(h2, field, note, checkBtn);
  checkBtn.addEventListener("click", () => {
    void busy(checkBtn, async () => {
      const pin = input.value.trim();
      if (!/^\d{6}$/.test(pin) || pin.startsWith("0")) {
        note.textContent = "Enter a 6-digit pincode.";
        return;
      }
      try {
        const info = await get<{ pincode: string; city: string | null; state: string | null; serviceable: boolean; cod_available: boolean }>(`/api/pincodes/${pin}`);
        state.pincode = pin;
        window.localStorage.setItem(PINCODE_KEY, pin);
        dlg.close();
        const back = opener;
        dlg.remove();
        if (back) back.focus();
        await route();
        announce(info.serviceable ? `Delivers to ${info.city ?? pin}.` : `We don't deliver to ${pin} yet.`);
      } catch (err) {
        note.textContent = err instanceof Error ? err.message : "Enter a 6-digit pincode.";
      }
    });
  });
  document.body.append(dlg);
  dlg.showModal();
  queueMicrotask(() => input.focus());
}

onSignedOut(() => {
  state.account = null;
  const target = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  void navigate(target, true);
});

export function initEffects(): void {
  magneticCursor();
}

export function main(): void {
  loadLocal();
  refreshMe()
    .then(() => refreshCartCount())
    .then(() => route())
    .then(() => {
      const status = new URLSearchParams(window.location.search).get("signed_out");
      if (status) announce("Your session ended. Sign in again to continue.");
      initEffects();
    });
  window.addEventListener("popstate", () => { void route(); });
  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement)?.closest?.("a");
    if (!target) return;
    const href = target.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("/api/")) return;
    if (target.hasAttribute("download") || target.hasAttribute("target")) return;
    e.preventDefault();
    void navigate(href);
  });
}

void amount;
void esc;
