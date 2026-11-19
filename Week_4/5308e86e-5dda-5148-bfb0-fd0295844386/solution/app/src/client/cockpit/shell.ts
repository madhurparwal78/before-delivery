/** The cockpit frame: accounts rail and drawer, avatar menu, profile, and the rail's live content. */
import breakpoints from "../../shared/breakpoints.json";
import { formatDollars } from "../../shared/money.js";
import { h, openModal, query, trapTab } from "../shared/dom.js";
import { initials } from "../shared/format.js";
import { rememberAccount, signOut } from "../shared/session.js";
import { currentMe, on, store } from "./store.js";

const WIDE = `(min-width: ${breakpoints.railInline}px)`;

interface ShellOptions {
  /** The account whose row is current in the rail, or null when no account is current. */
  activeAccountId: () => string | null;
}

export function mountShell(options: ShellOptions): { renderRail: () => void } {
  const rail = query(document, "[data-rail]");
  const toggle = query<HTMLButtonElement>(document, "[data-accounts-toggle]");
  const scrim = query(document, "[data-rail-scrim]");
  const wide = window.matchMedia(WIDE);

  function currentLink(): HTMLElement | null {
    return rail.querySelector<HTMLElement>('[aria-current="page"]') ?? rail.querySelector<HTMLElement>("a");
  }

  function openDrawer(): void {
    rail.setAttribute("data-open", "");
    toggle.setAttribute("aria-expanded", "true");
    scrim.hidden = false;
    currentLink()?.focus();
  }

  function closeDrawer(returnFocus: boolean): void {
    rail.removeAttribute("data-open");
    toggle.setAttribute("aria-expanded", "false");
    scrim.hidden = true;
    if (returnFocus) toggle.focus();
  }

  toggle.addEventListener("click", () => (rail.hasAttribute("data-open") ? closeDrawer(true) : openDrawer()));
  scrim.addEventListener("click", () => closeDrawer(true));
  rail.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a") && !wide.matches) closeDrawer(false);
  });
  rail.addEventListener("keydown", (event) => {
    if (!rail.hasAttribute("data-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer(true);
    } else trapTab(rail, event);
  });
  wide.addEventListener("change", () => {
    if (!wide.matches || !rail.hasAttribute("data-open")) return;
    const hadFocus = rail.contains(document.activeElement);
    closeDrawer(false);
    if (hadFocus) currentLink()?.focus();
  });

  const accountsList = query(rail, "[data-rail-accounts]");
  const approvalsLink = query<HTMLAnchorElement>(rail, '[data-page-link="approvals"]');

  function renderRail(): void {
    const active = options.activeAccountId();
    const present = new Map<string, HTMLElement>();
    for (const item of accountsList.querySelectorAll<HTMLElement>("li[data-account]")) present.set(item.dataset.account ?? "", item);
    const ordered: HTMLElement[] = [];
    for (const account of store.accounts) {
      let item = present.get(account.id);
      if (!item) {
        item = h(
          "li",
          { "data-account": account.id },
          h("a", { class: "rail-link rail-account", href: `/app/accounts/${account.id}` }, h("span", { class: "rail-name" }), h("span", { class: "rail-balance mono" })),
        );
      }
      const link = query<HTMLAnchorElement>(item, "a");
      query(link, ".rail-name").textContent = account.name;
      query(link, ".rail-balance").textContent = formatDollars(account.balance_cents);
      link.setAttribute("aria-label", `${account.name} ${formatDollars(account.balance_cents)}`);
      if (account.id === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      ordered.push(item);
    }
    for (const stale of [...accountsList.children]) if (!ordered.includes(stale as HTMLElement)) stale.remove();
    ordered.forEach((item, index) => {
      if (accountsList.children[index] !== item) accountsList.insertBefore(item, accountsList.children[index] ?? null);
    });
    const waiting = store.waiting;
    if (waiting > 0) approvalsLink.setAttribute("aria-label", `Approvals, ${waiting} waiting`);
    else approvalsLink.removeAttribute("aria-label");
    let badge = approvalsLink.querySelector<HTMLElement>(".rail-badge");
    if (waiting > 0) {
      if (!badge) {
        badge = h("span", { class: "rail-badge", "aria-hidden": "true" });
        approvalsLink.append(badge);
      }
      badge.textContent = String(waiting);
    } else badge?.remove();
    const current = accountsList.querySelector('[aria-current="page"]');
    if (current && active) rememberAccount(active);
  }

  on("accounts", renderRail);
  on("waiting", renderRail);
  mountAvatarMenu();
  return { renderRail };
}

function mountAvatarMenu(): void {
  const wrap = query(document, "[data-avatar-wrap]");
  const avatar = query<HTMLButtonElement>(wrap, "[data-avatar]");
  const menu = query(wrap, "[data-avatar-menu]");
  const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];

  function open(): void {
    menu.hidden = false;
    avatar.setAttribute("aria-expanded", "true");
    items[0]?.focus();
  }

  function close(returnFocus: boolean): void {
    menu.hidden = true;
    avatar.setAttribute("aria-expanded", "false");
    if (returnFocus) avatar.focus();
  }

  avatar.addEventListener("click", () => (menu.hidden ? open() : close(true)));
  wrap.addEventListener("keydown", (event) => {
    if (menu.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  });
  wrap.addEventListener("focusout", (event) => {
    if (!menu.hidden && !wrap.contains(event.relatedTarget as Node | null)) close(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !wrap.contains(event.target as Node)) close(false);
  });
  query(menu, "[data-logout]").addEventListener("click", () => void signOut());
  query(menu, "[data-profile]").addEventListener("click", () => {
    close(false);
    openProfile(avatar);
  });
}

function openProfile(opener: HTMLElement): void {
  const { user, company } = currentMe();
  const dialog = h(
    "dialog",
    { class: "dialog", "aria-label": "Profile" },
    h("h2", { class: "dialog-title" }, "Profile"),
    h("dl", { class: "profile" }, h("dt", {}, "Name"), h("dd", {}, user.name), h("dt", {}, "Email"), h("dd", {}, user.email), h("dt", {}, "Role"), h("dd", {}, user.role), h("dt", {}, "Company"), h("dd", {}, company.name)),
    h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-primary", type: "button", "data-close": "" }, "Close")),
  );
  const close = openModal(dialog, opener);
  query(dialog, "[data-close]").addEventListener("click", () => close(true));
}

/** Fills the avatar with the user's initials. */
export function paintAvatar(): void {
  query(document, "[data-initials]").textContent = initials(currentMe().user.name);
}
