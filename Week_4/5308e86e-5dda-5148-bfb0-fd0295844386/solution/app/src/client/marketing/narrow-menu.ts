/** The "Open Menu" panel below the header's inline width: slides in, holds Tab, and closes on Escape. */
import { focusableWithin, HEADER_INLINE_QUERY } from "./dom";

export function initNarrowMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-narrow-toggle]");
  const panel = document.getElementById("narrow-menu");
  const scrim = document.querySelector<HTMLElement>("[data-narrow-scrim]");
  if (!toggle || !panel || !scrim) return;

  const groups = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-narrow-group]")).flatMap((trigger) => {
    const list = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    return list ? [{ trigger, list }] : [];
  });

  const setGroupOpen = (group: { trigger: HTMLButtonElement; list: HTMLElement }, open: boolean): void => {
    group.list.hidden = !open;
    group.trigger.setAttribute("aria-expanded", String(open));
  };

  const setOpen = (open: boolean): void => {
    if (!open) for (const group of groups) setGroupOpen(group, false);
    panel.hidden = !open;
    scrim.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("narrow-menu-open", open);
  };

  const isOpen = (): boolean => !panel.hidden;

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => {
    if (isOpen()) {
      close(false);
      return;
    }
    setOpen(true);
    focusableWithin(panel)[0]?.focus();
  });

  scrim.addEventListener("click", () => close(true));

  for (const group of groups) {
    group.trigger.addEventListener("click", () => setGroupOpen(group, group.list.hidden));
  }

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusableWithin(panel);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (!panel.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.matchMedia(HEADER_INLINE_QUERY).addEventListener("change", (query) => {
    if (query.matches) close(false);
  });
}
