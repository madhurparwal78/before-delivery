import { statusRegion } from "./announce.js";
import { COMPANY } from "../shared/titles.js";
import { FOOTER_LINES, ONLINE_STORE } from "./copy.js";
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { reducedMotion } from "./motion.js";
import { CHAPTERS, chapterNumber, type ChapterId } from "./story/chapters.js";

const SITE_LINKS = [
  { label: "About", href: "/#about" },
  { label: "Science & Technology", href: "/#science" },
  { label: "Product", href: "/#product" },
  { label: "Interview", href: "/#interviews" },
  { label: ONLINE_STORE, href: "/store" },
] as const;

const FOOTER_NAV = [
  ...SITE_LINKS,
  { label: "Contact", href: "/contact" },
  { label: "Privacy", href: "/privacy" },
  { label: "Legal", href: "/legal" },
] as const;

function chapterLink(index: number, className: string): HTMLAnchorElement {
  const { id, title } = CHAPTERS[index];
  return h("a", { href: `/#${id}`, class: className, "data-chapter-link": id },
    h("span", { class: "chapter-number" }, chapterNumber(index)), " ", h("span", { class: "chapter-title" }, title));
}

function linkList(links: readonly { label: string; href: string }[], className: string): HTMLUListElement {
  return h("ul", { class: className }, ...links.map((link) => h("li", {}, h("a", { href: link.href }, link.label))));
}

/**
 * The header, chapter rail, menu dialog, footer and status region that every page shares. The chapter rail
 * belongs to the story page only.
 */
export function buildChrome(root: HTMLElement) {
  const main = h("main", { id: "main" });
  const skip = h("a", { class: "skip-link", href: "#main" }, "Skip to story");
  skip.addEventListener("click", (event) => {
    event.preventDefault();
    main.querySelector<HTMLElement>("h1")?.focus();
  });

  const menuButton = h("button", { class: "menu-button", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" },
    h("span", {}, "Menu"), icon("menu"));
  const header = h("header", { class: "site-header" },
    h("a", { class: "home-link", href: "/", "aria-label": `${COMPANY} home` },
      h("span", { class: "home-mark", "aria-hidden": "true" }), h("span", { class: "home-name" }, "Alder Quay", h("span", { class: "home-long" }, " Laboratories"))),
    h("nav", { class: "site-nav", "aria-label": "Site" }, linkList(SITE_LINKS, "site-links")),
    menuButton);

  const railLinks = CHAPTERS.map((_chapter, index) => chapterLink(index, "rail-link"));
  const rail = h("nav", { class: "rail", "aria-label": "Chapters", hidden: true },
    h("ol", {}, ...railLinks.map((link) => h("li", {}, link))));

  const footer = h("footer", { class: "site-footer" },
    h("div", { class: "footer-copy" }, ...FOOTER_LINES.map((line) => h("p", {}, line))),
    h("nav", { "aria-label": "Footer" }, linkList(FOOTER_NAV, "footer-links")));

  const menuLinks = CHAPTERS.map((_chapter, index) => chapterLink(index, "menu-link"));
  const closeButton = h("button", { class: "menu-close", type: "button" }, "Close", h("span", { class: "visually-hidden" }, " menu"), icon("close"));
  const menu = h("div", { class: "menu", role: "dialog", "aria-modal": "true", "aria-label": "Menu", hidden: true },
    h("div", { class: "menu-panel" },
      closeButton,
      h("nav", { "aria-label": "Menu chapters" }, h("ol", {}, ...menuLinks.map((link) => h("li", {}, link)))),
      h("ul", { class: "menu-more" },
        h("li", {}, h("a", { href: "/store" }, ONLINE_STORE)),
        h("li", {}, h("a", { href: "/contact" }, "Contact")))));

  const behindMenu = [skip, header, rail, main, footer];
  let generation = 0;

  const finishClosing = (turn: number): void => {
    if (turn !== generation) return;
    menu.hidden = true;
    menu.classList.remove("closing");
    menu.inert = false;
    menu.removeAttribute("aria-hidden");
  };

  const openMenu = (): void => {
    generation += 1;
    menu.hidden = false;
    menu.inert = false;
    menu.removeAttribute("aria-hidden");
    menu.classList.remove("closing");
    if (!reducedMotion()) menu.classList.add("opening");
    menuButton.setAttribute("aria-expanded", "true");
    behindMenu.forEach((part) => { part.inert = true; });
    menu.querySelector<HTMLElement>(".menu-link")?.focus();
  };

  /** From the moment closing starts nothing in the menu can be reached, even while it slides away. */
  const closeMenu = (): void => {
    const turn = (generation += 1);
    behindMenu.forEach((part) => { part.inert = false; });
    menu.inert = true;
    menu.setAttribute("aria-hidden", "true");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.focus();
    menu.classList.remove("opening");
    if (reducedMotion()) {
      finishClosing(turn);
      return;
    }
    menu.classList.add("closing");
    menu.addEventListener("animationend", () => finishClosing(turn), { once: true });
  };

  menuButton.addEventListener("click", openMenu);
  closeButton.addEventListener("click", closeMenu);
  menu.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) closeMenu();
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key !== "Tab") return;
    const reachable = [closeButton, ...menu.querySelectorAll<HTMLElement>("a[href]")];
    const first = reachable[0];
    const last = reachable[reachable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  root.append(skip, header, rail, main, footer, menu, statusRegion());

  return {
    main,
    footer,
    showRail(visible: boolean): void {
      rail.hidden = !visible;
      root.classList.toggle("has-rail", visible);
      if (!visible) this.markCurrent(null);
    },
    markCurrent(id: ChapterId | null): void {
      for (const link of [...railLinks, ...menuLinks]) {
        if (link.getAttribute("data-chapter-link") === id) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    },
  };
}

export type Chrome = ReturnType<typeof buildChrome>;
