/** Header menus: Products, Solutions, Resources and About as keyboard-complete disclosures. */
import { focusableWithin, HEADER_INLINE_QUERY } from "./dom";

interface HeaderMenu {
  item: HTMLElement;
  trigger: HTMLButtonElement;
  panel: HTMLElement;
}

function panelLinks(menu: HeaderMenu): HTMLAnchorElement[] {
  return Array.from(menu.panel.querySelectorAll<HTMLAnchorElement>("a[href]"));
}

function isOpen(menu: HeaderMenu): boolean {
  return !menu.panel.hidden;
}

/** A closed panel is hidden at once, so none of its links stays in the accessibility tree or the Tab order. */
function setOpen(menu: HeaderMenu, open: boolean): void {
  menu.panel.hidden = !open;
  menu.trigger.setAttribute("aria-expanded", String(open));
}

function readMenus(bar: HTMLElement): HeaderMenu[] {
  return Array.from(bar.querySelectorAll<HTMLElement>("[data-header-menu]")).flatMap((item) => {
    const trigger = item.querySelector<HTMLButtonElement>("[data-menu-trigger]");
    const panel = document.getElementById(trigger?.getAttribute("aria-controls") ?? "");
    return trigger && panel ? [{ item, trigger, panel }] : [];
  });
}

export function initHeaderMenus(): void {
  const bar = document.querySelector<HTMLElement>(".header-bar");
  if (!bar) return;
  const menus = readMenus(bar);

  const closeAll = (except?: HeaderMenu): void => {
    for (const menu of menus) if (menu !== except) setOpen(menu, false);
  };

  const open = (menu: HeaderMenu): void => {
    closeAll(menu);
    setOpen(menu, true);
  };

  /** Tab from the last link closes the panel and lands on the next control in the header. */
  const leaveForward = (menu: HeaderMenu): boolean => {
    setOpen(menu, false);
    const controls = focusableWithin(bar);
    const next = controls[controls.indexOf(menu.trigger) + 1];
    if (!next) return false;
    next.focus();
    return true;
  };

  for (const menu of menus) {
    menu.trigger.addEventListener("click", () => {
      if (isOpen(menu)) setOpen(menu, false);
      else open(menu);
    });

    menu.trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        open(menu);
        panelLinks(menu)[0]?.focus();
      } else if (event.key === "Escape" && isOpen(menu)) {
        event.preventDefault();
        setOpen(menu, false);
      }
    });

    menu.panel.addEventListener("keydown", (event) => {
      const links = panelLinks(menu);
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);
      const last = links.length - 1;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          links[current >= last ? 0 : current + 1]?.focus();
          break;
        case "ArrowUp":
          event.preventDefault();
          links[current <= 0 ? last : current - 1]?.focus();
          break;
        case "Home":
          event.preventDefault();
          links[0]?.focus();
          break;
        case "End":
          event.preventDefault();
          links[last]?.focus();
          break;
        case "Escape":
          event.preventDefault();
          setOpen(menu, false);
          menu.trigger.focus();
          break;
        case "Tab":
          if (event.shiftKey && current === 0) {
            event.preventDefault();
            menu.trigger.focus();
          } else if (!event.shiftKey && current === last && leaveForward(menu)) {
            event.preventDefault();
          }
          break;
      }
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    for (const menu of menus) if (isOpen(menu) && !menu.item.contains(target)) setOpen(menu, false);
  });

  window.matchMedia(HEADER_INLINE_QUERY).addEventListener("change", () => closeAll());
}
