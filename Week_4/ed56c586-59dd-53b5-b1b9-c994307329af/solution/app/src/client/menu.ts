import { must } from "./dom.js";
import { Modal } from "./modal.js";
import { onViewportChange } from "./viewport.js";

/** The `Menu` dialog under 1024 px: slides down from the top edge over 250 ms and back up when it closes. */

const MENU_WIDE = 1024;

export function initMenu(siteRoot: HTMLElement): void {
  const opener = must<HTMLButtonElement>(document, "[data-menu-open]");
  const layer = must<HTMLElement>(document, '[data-modal-layer="menu"]');
  const dialog = must<HTMLElement>(layer, "[data-dialog]");
  const modal = new Modal(layer, dialog, siteRoot, {
    enter: [{ transform: "translateY(-100%)", opacity: 0.6 }, { transform: "translateY(0)", opacity: 1 }],
    exit: [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0.6 }],
    durationMs: 250,
  }, (open) => opener.setAttribute("aria-expanded", String(open)));
  opener.addEventListener("click", () => {
    modal.open(opener, () => must<HTMLElement>(dialog, 'nav a[href="/#about"]'));
  });
  must<HTMLElement>(dialog, "[data-modal-close]").addEventListener("click", () => modal.close(true));
  dialog.querySelectorAll("nav a").forEach((link) => link.addEventListener("click", () => modal.close(false)));
  onViewportChange(() => {
    if (modal.isOpen && window.innerWidth >= MENU_WIDE) modal.close(false);
  });
}
