// Every page's frame (brief: Header and footer): announcement bar, header menus, search, account, cart,
// phone menu, cart drawer, footer with the newsletter form, and the Announcements status region.
import { api } from "./api.ts";
import { openDialog } from "./dialog.ts";
import { EASE, h, reducedMotion, replace } from "./dom.ts";
import { busy, form, input, showRefusal } from "./forms.ts";
import { price } from "./format.ts";
import { icon } from "./icons.ts";
import { navigate } from "./router.ts";
import { onCartCount, onSession, refreshCart, session, setAnnouncer, setCartCount, setSession, type User } from "./state.ts";

interface MenuDef {
  label: string;
  links: { href: string; text: string }[];
  aside?: { title: string; text: string; href: string; link: string };
}

const MENUS: MenuDef[] = [
  {
    label: "Boards",
    links: [
      { href: "/boards#drift", text: "Drift" },
      { href: "/boards#crest", text: "Crest" },
      { href: "/boards#swift", text: "Swift" },
      { href: "/boards", text: "Compare all boards" },
    ],
    aside: { title: "Talk to a rider advisor", text: "Not sure which board fits your water? We call you back at a time that suits you.", href: "/callback", link: "Book a call" },
  },
  {
    label: "Parts",
    links: [
      { href: "/foil-boards", text: "Foil boards" },
      { href: "/parts", text: "Masts" },
      { href: "/parts#wings", text: "Wings" },
    ],
  },
  {
    label: "Ride",
    links: [
      { href: "/events", text: "Demo events" },
      { href: "/match", text: "Find my board" },
      { href: "/locations", text: "Demo stations" },
    ],
  },
  {
    label: "Help",
    links: [
      { href: "/track", text: "Track an order" },
      { href: "/support", text: "Support" },
      { href: "/protection", text: "Protection plans" },
      { href: "/shipping", text: "Shipping" },
    ],
  },
];

type Closable = { button: HTMLButtonElement; panel: HTMLElement };
let openMenu: Closable | null = null;

function closeMenu(focusButton = false): void {
  const menu = openMenu;
  if (!menu) return;
  openMenu = null;
  menu.button.setAttribute("aria-expanded", "false");
  if (focusButton) menu.button.focus();
  if (reducedMotion()) {
    menu.panel.hidden = true;
    return;
  }
  const fold = menu.panel.animate(
    [{ opacity: 1, transform: "scaleY(1)" }, { opacity: 0, transform: "scaleY(0.92)" }],
    { duration: 200, easing: EASE.accelerate },
  );
  fold.onfinish = () => {
    if (openMenu !== menu) menu.panel.hidden = true;
  };
}

function toggleMenu(menu: Closable): void {
  if (openMenu === menu) {
    closeMenu();
    return;
  }
  closeMenu();
  openMenu = menu;
  menu.button.setAttribute("aria-expanded", "true");
  menu.panel.getAnimations().forEach((a) => a.cancel());
  menu.panel.hidden = false;
  if (!reducedMotion()) {
    menu.panel.animate([{ opacity: 0, transform: "scaleY(0.92)" }, { opacity: 1, transform: "scaleY(1)" }], { duration: 300, easing: EASE.decelerate });
  }
}

function menuWidget(def: MenuDef): HTMLElement {
  const panel = h(
    "div",
    { class: "menu-panel", id: `menu-${def.label.toLowerCase()}`, hidden: true },
    h("ul", { class: "menu-links" }, def.links.map((l) => h("li", null, h("a", { href: l.href }, l.text)))),
    def.aside
      ? h("div", { class: "menu-aside" }, h("p", { class: "menu-aside-title" }, def.aside.title), h("p", null, def.aside.text), h("a", { href: def.aside.href, class: "onward" }, def.aside.link, icon("arrow", 18)))
      : null,
  );
  const button = h("button", { type: "button", class: "menu-button", "aria-expanded": "false", "aria-controls": panel.id }, def.label, icon("caret", 16, "icon caret"));
  const menu = { button, panel };
  button.addEventListener("click", () => toggleMenu(menu));
  return h("div", { class: "menu" }, button, panel);
}

function accountWidget(): HTMLElement {
  const panel = h("div", { class: "menu-panel account-panel", id: "menu-account", hidden: true });
  const button = h("button", { type: "button", class: "icon-button", "aria-label": "Account", "aria-expanded": "false", "aria-controls": panel.id }, icon("person", 22));
  const menu = { button, panel };
  button.addEventListener("click", () => toggleMenu(menu));
  const render = (user: User | null) => {
    if (!user) {
      replace(panel, h("a", { href: "/login" }, "Sign in"), h("a", { href: "/signup" }, "Create an account"));
      return;
    }
    const signOut = h("button", { type: "button", class: "text-button" }, "Sign out");
    signOut.addEventListener("click", async () => {
      await api("POST", "/api/auth/logout", {});
      setSession(null);
      closeMenu();
      await refreshCart();
      navigate("/");
    });
    replace(panel, h("p", { class: "caption" }, user.email), h("a", { href: user.role === "customer" ? "/account" : "/staff" }, "My account"), signOut);
  };
  void (async () => render(await session()))();
  onSession(render);
  return h("div", { class: "menu menu-right" }, button, panel);
}

function searchDialog(): { dialog: HTMLDialogElement; open(opener: HTMLElement): void } {
  const box = input("Search the catalog", { type: "search", name: "q", autocomplete: "off" });
  const results = h("ul", { class: "search-results", "aria-label": "Search results" });
  const note = h("p", { class: "caption search-note" });
  const close = h("button", { type: "button", class: "icon-button", "aria-label": "Close search" }, icon("cross", 22));
  // Results follow the box as it is typed (the newest answer wins); a refusal shows beneath it only on Enter.
  let sequence = 0;
  const run = async (submitted: boolean) => {
    const mine = ++sequence;
    const r = await api<{ results: { sku: string; name: string; price_cents: number }[] }>("GET", `/api/search?q=${encodeURIComponent(box.control.value)}`);
    if (mine !== sequence) return;
    replace(results);
    note.textContent = "";
    if (!r.ok) {
      if (submitted) showRefusal(r.error, { q: box }, f.alert);
      return;
    }
    box.setError(null);
    if (!r.data.results.length) note.textContent = "No matches.";
    replace(results, r.data.results.map((item) => h("li", null, h("span", null, item.name), h("span", { class: "caption" }, price(item.price_cents)))));
  };
  const f = form(
    {
      class: "search-form",
      onsubmit: (event: SubmitEvent) => {
        event.preventDefault();
        void run(true);
      },
    },
    box.wrap,
  );
  box.control.addEventListener("input", () => void run(false));
  const dialog = h("dialog", { class: "modal search-dialog", "aria-labelledby": "search-title" },
    h("div", { class: "modal-head" }, h("h2", { id: "search-title" }, "Search"), close), f.el, note, results);
  let opened: { close(): Promise<void> } | null = null;
  close.addEventListener("click", () => void opened?.close());
  return {
    dialog,
    open(opener) {
      opened = openDialog(dialog, opener, "dialog");
    },
  };
}

const drawerTitle = "Item added to your cart";
const drawer = h("dialog", { class: "drawer", "aria-labelledby": "drawer-title" });

/**
 * Opens the cart drawer after an add; focus starts on View cart and returns to `opener` on close. The header's
 * cart count takes the new item count as the drawer comes to rest.
 */
export function openCartDrawer(opener: HTMLElement, lineName: string, cart: { item_count: number; subtotal_cents: number }): void {
  const close = h("button", { type: "button", class: "pill pill-quiet" }, icon("cross", 18), "Close");
  replace(
    drawer,
    h("div", { class: "drawer-head" }, icon("tick", 22, "icon tick"), h("h2", { id: "drawer-title" }, drawerTitle)),
    h("p", { class: "drawer-line" }, lineName),
    h("p", { class: "caption" }, `${cart.item_count} items in your cart, subtotal ${price(cart.subtotal_cents)}`),
    h("div", { class: "drawer-actions" }, h("a", { href: "/cart", class: "pill" }, "View cart"), h("a", { href: "/checkout", class: "pill pill-outline" }, "Check out"), close),
  );
  const opened = openDialog(drawer, opener, "drawer", undefined, () => setCartCount(cart.item_count));
  close.addEventListener("click", () => void opened.close());
  drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => drawer.close()));
}

function phoneMenu(): { dialog: HTMLDialogElement; button: HTMLButtonElement } {
  const close = h("button", { type: "button", class: "icon-button", "aria-label": "Close" }, icon("cross", 22));
  const dialog = h("dialog", { class: "modal phone-menu", "aria-labelledby": "phone-menu-title" },
    h("div", { class: "modal-head" }, h("h2", { id: "phone-menu-title" }, "Menu"), close),
    MENUS.map((m) => h("section", { class: "phone-group" }, h("h3", null, m.label), h("ul", null, m.links.map((l) => h("li", null, h("a", { href: l.href }, l.text)))),
      m.aside ? h("a", { href: m.aside.href, class: "onward" }, m.aside.title, icon("arrow", 18)) : null)));
  const button = h("button", { type: "button", class: "menu-toggle", "aria-expanded": "false" }, icon("menu", 22), "Menu");
  let opened: { close(): Promise<void> } | null = null;
  button.addEventListener("click", () => {
    button.setAttribute("aria-expanded", "true");
    opened = openDialog(dialog, button, "dialog", () => button.setAttribute("aria-expanded", "false"));
  });
  close.addEventListener("click", () => void opened?.close());
  dialog.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => dialog.close()));
  return { dialog, button };
}

function newsletter(): HTMLElement {
  const email = input("Newsletter email", { type: "email", name: "email", autocomplete: "email", placeholder: "you@example.com" });
  email.wrap.querySelector("label")?.classList.add("sr-only");
  const consentId = "newsletter-consent";
  const consent = h("input", { type: "checkbox", id: consentId, name: "consent" });
  const consentError = h("p", { class: "field-error", hidden: true, id: "newsletter-consent-error" }, icon("error", 18, "icon error-icon"), h("span"));
  consent.setAttribute("aria-describedby", consentError.id);
  const done = h("p", { class: "newsletter-done", role: "status" });
  const submit = h("button", { type: "submit", class: "pill pill-light", "aria-label": "Sign up for the newsletter" }, "Sign up");
  const f = form(
    {
      class: "newsletter",
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        done.textContent = "";
        const r = await busy(submit, "Signing up...", () => api<{ message: string }>("POST", "/api/newsletter", { email: email.control.value, consent: consent.checked }));
        const consentField = {
          wrap: consentError, control: consent,
          setError(m: string | null) {
            consentError.hidden = !m;
            (consentError.lastChild as HTMLElement).textContent = m ?? "";
          },
        };
        if (!r.ok) {
          showRefusal(r.error, { email, consent: consentField }, f.alert);
          return;
        }
        email.setError(null);
        consentField.setError(null);
        done.textContent = r.data.message;
      },
    },
    h("h2", { class: "footer-title" }, "The Tern Foils dispatch: new parts and demo dates"),
    h("div", { class: "newsletter-row" }, email.wrap, submit),
    h("div", { class: "check" }, consent, h("label", { for: consentId }, "I agree to receive the dispatch and have read the privacy notice")),
    consentError,
    done,
  );
  return f.el;
}

function footer(): HTMLElement {
  const group = (title: string, links: [string, string][]) =>
    h("nav", { class: "footer-group", "aria-label": title }, h("h2", { class: "footer-title" }, title), h("ul", null, links.map(([href, text]) => h("li", null, h("a", { href }, text)))));
  return h(
    "footer",
    { class: "site-footer" },
    h("div", { class: "wrap footer-grid" },
      group("Shop", [["/boards", "All boards"], ["/build", "Configure a board"], ["/foil-boards", "Unpowered foil boards"], ["/parts", "Masts and wings"]]),
      group("Ride", [["/locations", "Demo stations"], ["/events", "Demo events"], ["/match", "Board quiz"], ["/trade-in", "Trade-in"]]),
      group("Company", [["/contact", "Write to the workshop"], ["/faq", "Rider questions"], ["/partners", "Become a partner"], ["/privacy-policy", "Privacy policy"]]),
      newsletter()),
    h("div", { class: "wrap footer-base" }, h("p", null, "(C) 2026 Tern Foils")),
  );
}

export function mountLayout(root: HTMLElement): HTMLElement {
  const main = h("main", { id: "main", tabindex: "-1" });
  const status = h("div", { role: "status", "aria-live": "polite", "aria-label": "Announcements", class: "sr-only" });
  setAnnouncer(status);
  const search = searchDialog();
  const phone = phoneMenu();
  const searchButton = h("button", { type: "button", class: "icon-button", "aria-label": "Search" }, icon("search", 22));
  searchButton.addEventListener("click", () => {
    closeMenu();
    search.open(searchButton);
  });
  const badge = h("span", { class: "badge", "aria-hidden": "true" }, "0");
  const cartLink = h("a", { href: "/cart", class: "icon-button cart-link", "aria-label": "Cart, 0 items" }, icon("bag", 22), badge);
  onCartCount((n) => {
    cartLink.setAttribute("aria-label", `Cart, ${n} items`);
    badge.textContent = String(n);
  });
  const header = h(
    "header",
    { class: "site-header" },
    h("div", { class: "wrap header-row" },
      h("a", { href: "/", class: "wordmark", "aria-label": "Tern Foils home" }, h("span", { class: "wordmark-mark", "aria-hidden": "true" }), "Tern Foils"),
      h("nav", { class: "header-menus", "aria-label": "Main" }, MENUS.map(menuWidget)),
      h("div", { class: "header-actions" }, searchButton, accountWidget(), cartLink, phone.button)),
  );
  replace(
    root,
    h("a", { href: "#main", class: "skip-link" }, "Skip to content"),
    h("div", { class: "announcement" }, h("a", { href: "/trade-in" }, "Trade in your old board for credit")),
    header,
    main,
    footer(),
    status,
    search.dialog,
    phone.dialog,
    drawer,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openMenu) closeMenu(true);
  });
  document.addEventListener("click", (event) => {
    if (openMenu && !(event.target instanceof Node && openMenu.panel.parentElement?.contains(event.target))) closeMenu();
  });
  header.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest(".menu-panel a")) closeMenu();
  });
  void refreshCart();
  return main;
}
