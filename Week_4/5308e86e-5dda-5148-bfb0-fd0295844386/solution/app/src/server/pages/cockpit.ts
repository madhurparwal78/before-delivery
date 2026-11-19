/** The cockpit shell: top bar, accounts rail and an empty page mount. It holds no company data; the page fills it after sign-in. */
import { documentShell, type RenderedPage } from "./layout.js";

interface CockpitPageDefinition {
  page: string;
  title: string;
  heading: string;
}

/** Every cockpit address that needs a session, by exact path. The account page is matched by prefix. */
const COCKPIT_PAGES: Record<string, CockpitPageDefinition> = {
  "/app": { page: "home", title: "Overview", heading: "Overview" },
  "/payments": { page: "payments", title: "Payments", heading: "Payments" },
  "/payments/new": { page: "send-payment", title: "Send payment", heading: "Send payment" },
  "/payments/recipients": { page: "recipients", title: "Recipients", heading: "Recipients" },
  "/payments/recipients/new": { page: "recipient-new", title: "Add recipient", heading: "Add recipient" },
  "/approvals": { page: "approvals", title: "Approvals", heading: "Approvals" },
  "/invoices": { page: "invoices", title: "Invoicing", heading: "Invoicing" },
  "/loans": { page: "loans", title: "Loans", heading: "Loans" },
  "/cards": { page: "cards", title: "Cards", heading: "Cards" },
  "/treasury-account": { page: "treasury-account", title: "Treasury", heading: "Treasury" },
  "/bill-pay": { page: "bill-pay", title: "Bill Pay", heading: "Bill Pay" },
};

const ACCOUNT_PAGE_PREFIX = "/app/accounts/";
const ACCOUNT_PAGE: CockpitPageDefinition = { page: "account", title: "Account", heading: "Account" };

export function cockpitPageFor(path: string): CockpitPageDefinition | null {
  if (path.startsWith(ACCOUNT_PAGE_PREFIX) && path.length > ACCOUNT_PAGE_PREFIX.length && !path.slice(ACCOUNT_PAGE_PREFIX.length).includes("/")) return ACCOUNT_PAGE;
  return COCKPIT_PAGES[path] ?? null;
}

const MARK = `<svg class="brand-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false"><path d="M16 16c2.6-4.6 5.6-7 8.4-7 3.1 0 5.1 2.2 5.1 5s-2 5-5.1 5c-2.8 0-5.8-2.4-8.4-7zm0 0c-2.6 4.6-5.6 7-8.4 7-3.1 0-5.1-2.2-5.1-5s2-5 5.1-5c2.8 0 5.8 2.4 8.4 7z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const MENU_GLYPH = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const SEARCH_GLYPH = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const PAGE_LINKS: Array<{ label: string; href: string; id: string }> = [
  { label: "Payments", href: "/payments", id: "payments" },
  { label: "Recipients", href: "/payments/recipients", id: "recipients" },
  { label: "Approvals", href: "/approvals", id: "approvals" },
  { label: "Invoicing", href: "/invoices", id: "invoices" },
  { label: "Loans", href: "/loans", id: "loans" },
  { label: "Cards", href: "/cards", id: "cards" },
  { label: "Treasury", href: "/treasury-account", id: "treasury-account" },
  { label: "Bill Pay", href: "/bill-pay", id: "bill-pay" },
];

export function cockpitDocument(definition: CockpitPageDefinition): RenderedPage {
  const pageLinks = PAGE_LINKS.map(
    (link) => `<li><a class="rail-link" href="${link.href}" data-page-link="${link.id}"${link.id === definition.page || (link.id === "recipients" && definition.page === "recipient-new") ? ' aria-current="page"' : ""}>${link.label}</a></li>`,
  ).join("");
  const body = `<div class="cockpit" data-cockpit>
      <header class="topbar">
        <a class="brand" href="/app" aria-label="Tallwind home">${MARK}<span class="brand-word" aria-hidden="true">Tallwind</span></a>
        <button class="icon-button accounts-toggle" type="button" aria-label="Accounts menu" aria-expanded="false" aria-controls="rail" data-accounts-toggle>${MENU_GLYPH}</button>
        <div class="search" data-search>
          <span class="search-glyph">${SEARCH_GLYPH}</span>
          <input class="search-input" type="search" role="searchbox" aria-label="Search" placeholder="Search transactions, recipients, or jump to a payment" autocomplete="off" spellcheck="false" data-search-input>
          <div class="search-results" role="region" aria-label="Search results" hidden data-search-results></div>
        </div>
        <div class="avatar-wrap" data-avatar-wrap>
          <button class="avatar" type="button" aria-expanded="false" aria-haspopup="menu" aria-controls="account-menu" data-avatar><span class="sr-only">Account menu </span><span data-initials></span></button>
          <div class="avatar-menu" id="account-menu" role="menu" hidden data-avatar-menu>
            <button class="menu-item" type="button" role="menuitem" data-profile>Profile</button>
            <button class="menu-item" type="button" role="menuitem" data-logout>Log out</button>
          </div>
        </div>
      </header>
      <aside class="rail" id="rail" aria-label="Accounts and pages" data-rail>
        <nav aria-label="Accounts"><p class="rail-caption" aria-hidden="true">Accounts</p><ul class="rail-accounts" data-rail-accounts></ul></nav>
        <nav aria-label="Pages"><ul class="rail-pages">${pageLinks}</ul></nav>
      </aside>
      <div class="rail-scrim" data-rail-scrim hidden></div>
      <main class="content" id="main" tabindex="-1">
        <h1 class="page-title" id="page-title" tabindex="-1">${definition.heading}</h1>
        <div class="page-root" data-page-root></div>
      </main>
    </div>`;
  return documentShell({
    title: `${definition.title} · Tallwind`,
    page: definition.page,
    bodyClass: "app-body",
    styles: ["/assets/css/cockpit.css"],
    scripts: ["/assets/cockpit.js"],
    body,
    private: true,
  });
}
