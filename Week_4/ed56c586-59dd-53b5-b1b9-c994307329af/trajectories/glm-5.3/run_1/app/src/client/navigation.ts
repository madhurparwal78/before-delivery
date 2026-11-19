/**
 * Header navigation, the mobile menu, section jumps, jump history and the
 * focus rule. Back and Forward restore each entry's position, focus and
 * current link instantly.
 */
import { prefersReducedMotion, qs, qsa } from "./core.js";
import { ensureFocusClear, headingOf, instantToHeading, jumpToSection, placeHeading } from "./jump.js";

type MenuState = {
  open: boolean;
  closing: boolean;
  closeTimer: number;
  opener: HTMLButtonElement | null;
};

let menu: MenuState | null = null;

export function initNavigation(): void {
  initMenu();
  initHeaderLinks();
  initBackToTop();
  initSkipLink();
  initFocusRule();
  window.addEventListener("popstate", () => {
    void restoreEntry();
  });
  void restoreEntry();
  // the browser's own fragment scroll lands after DOMContentLoaded, so a hash
  // entry is settled once more on the load event
  window.addEventListener("load", () => {
    const hash = new URL(window.location.href).hash.replace(/^#/, "");
    if (hash && headingOf(hash)) placeHeading(hash);
  });
}

/** `Skip to content` moves focus to the level-1 heading. */
function initSkipLink(): void {
  const link = qs<HTMLAnchorElement>("[data-skip-link]");
  link?.addEventListener("click", (event) => {
    event.preventDefault();
    const h1 = document.querySelector<HTMLElement>("main h1");
    if (h1) {
      h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
      const top = h1.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: "auto" });
    }
  });
}

async function restoreEntry(): Promise<void> {
  const url = new URL(window.location.href);
  const hash = url.hash.replace(/^#/, "");
  if (hash && headingOf(hash)) {
    instantToHeading(hash);
    return;
  }
  if (!hash && window.scrollY === 0) {
    // an entry without a hash shows the top of the page with focus on the h1,
    // but only after a visitor-caused navigation, never on a fresh load
    const h1 = document.querySelector<HTMLElement>("h1");
    if (h1 && document.referrer !== "") {
      h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
    }
  }
}

function initMenu(): void {
  const button = qs<HTMLButtonElement>("[data-menu-button]");
  const dialog = qs<HTMLElement>("[data-menu-dialog]");
  const backdrop = qs<HTMLElement>("[data-menu-backdrop]");
  const close = qs<HTMLButtonElement>("[data-menu-close]");
  if (!button || !dialog || !backdrop || !close) return;
  menu = { open: false, closing: false, closeTimer: 0, opener: button };

  const focusables = (): HTMLElement[] =>
    qsa<HTMLElement>(
      "a[href], button:not([disabled])",
      dialog
    ).filter((element) => element.offsetParent !== null);

  const openMenu = (): void => {
    if (!menu) return;
    if (menu.closing) {
      window.clearTimeout(menu.closeTimer);
      menu.closing = false;
      dialog.dataset.state = "opening";
      dialog.hidden = false;
      backdrop.hidden = false;
      return;
    }
    if (menu.open) return;
    menu.open = true;
    button.setAttribute("aria-expanded", "true");
    dialog.dataset.state = "opening";
    dialog.hidden = false;
    backdrop.hidden = false;
    const first = qs<HTMLElement>("[data-menu-nav] a", dialog);
    if (first) first.focus({ preventScroll: true });
  };

  const closeMenu = (): void => {
    if (!menu || !menu.open || menu.closing) return;
    menu.closing = true;
    dialog.dataset.state = "closing";
    const finish = (): void => {
      if (!menu) return;
      menu.closing = false;
      menu.open = false;
      dialog.hidden = true;
      backdrop.hidden = true;
      dialog.removeAttribute("data-state");
      button.setAttribute("aria-expanded", "false");
      button.focus({ preventScroll: true });
    };
    if (prefersReducedMotion()) {
      finish();
    } else {
      menu.closeTimer = window.setTimeout(finish, 240);
    }
  };

  button.addEventListener("click", () => {
    if (menu?.open) closeMenu();
    else openMenu();
  });
  close.addEventListener("click", closeMenu);
  backdrop.addEventListener("click", closeMenu);
  window.addEventListener("keydown", (event) => {
    if (!menu?.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  for (const link of qsa<HTMLAnchorElement>("[data-menu-nav] a", dialog)) {
    link.addEventListener("click", () => {
      if (!menu) return;
      menu.open = false;
      menu.closing = false;
      window.clearTimeout(menu.closeTimer);
      dialog.hidden = true;
      backdrop.hidden = true;
      dialog.removeAttribute("data-state");
      button.setAttribute("aria-expanded", "false");
    });
  }
}

function initHeaderLinks(): void {
  for (const link of qsa<HTMLAnchorElement>("[data-header-link], [data-section-jump], .footer-link")) {
    const hash = link.getAttribute("href")?.split("#")[1];
    if (!hash) continue;
    if (link.dataset.sectionJump) {
      // hero links jump and focus without a page load
      link.addEventListener("click", (event) => {
        event.preventDefault();
        jumpToSection(hash, { history: true });
      });
    } else {
      link.addEventListener("click", (event) => {
        if (link.closest("[data-menu-dialog]")) return;
        const samePage = window.location.pathname === "/";
        if (!samePage) return;
        event.preventDefault();
        jumpToSection(hash, { history: true });
      });
    }
  }
  for (const link of qsa<HTMLAnchorElement>("[data-menu-nav] a")) {
    link.addEventListener("click", (event) => {
      const hash = link.getAttribute("href")?.split("#")[1];
      if (!hash) return;
      const samePage = window.location.pathname === "/";
      if (!samePage) return;
      event.preventDefault();
      jumpToSection(hash, { history: true });
    });
  }
  const logo = qs<HTMLAnchorElement>("[data-home-link]");
  logo?.addEventListener("click", (event) => {
    if (window.location.pathname !== "/") return;
    event.preventDefault();
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.pushState({}, "", url);
    const behaviour: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    window.scrollTo({ top: 0, behavior: behaviour });
    const h1 = document.querySelector<HTMLElement>("h1");
    if (h1) {
      h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
    }
  });
}

function initBackToTop(): void {
  const button = qs<HTMLButtonElement>("[data-back-to-top]");
  button?.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.pushState({}, "", url);
    const behaviour: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    window.scrollTo({ top: 0, behavior: behaviour });
    const h1 = document.querySelector<HTMLElement>("h1");
    if (h1) {
      h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
    }
  });
}

function initFocusRule(): void {
  document.addEventListener("focusin", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(".header, .menu-dialog, .dialog, .skip-link")) return;
    ensureFocusClear(target);
  });
}
