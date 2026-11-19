import { all, must, play, prefersReducedMotion, whenFinished } from "./dom.js";

/** The service panels: at most one is open. A closed or closing panel is hidden from screen readers and inert at once;
 * the panel's height opens or closes over 300 ms and the service's visual plays its own motion as it opens. */

const PANEL_MS = 300;

export function initServices(): void {
  const items = all<HTMLElement>(document, "[data-service]");

  const close = (item: HTMLElement): void => {
    const panel = must<HTMLElement>(item, "[data-service-panel]");
    const button = must<HTMLButtonElement>(item, ".service-button");
    if (button.getAttribute("aria-expanded") !== "true") return;
    button.setAttribute("aria-expanded", "false");
    item.dataset["open"] = "false";
    panel.inert = true;
    panel.setAttribute("aria-hidden", "true");
    panel.getAnimations().forEach((animation) => animation.cancel());
    const animation = play(panel, [{ height: `${panel.offsetHeight}px` }, { height: "0px" }], { duration: PANEL_MS, easing: "ease-in-out", fill: "forwards" });
    whenFinished(animation, () => {
      if (item.dataset["open"] === "false") {
        panel.hidden = true;
        animation?.cancel();
      }
    });
  };

  const open = (item: HTMLElement): void => {
    const panel = must<HTMLElement>(item, "[data-service-panel]");
    const button = must<HTMLButtonElement>(item, ".service-button");
    const from = panel.hidden ? 0 : panel.offsetHeight;
    panel.getAnimations().forEach((animation) => animation.cancel());
    panel.hidden = false;
    panel.inert = false;
    panel.removeAttribute("aria-hidden");
    button.setAttribute("aria-expanded", "true");
    item.dataset["open"] = "true";
    if (!prefersReducedMotion()) play(panel, [{ height: `${from}px` }, { height: `${panel.scrollHeight}px` }], { duration: PANEL_MS, easing: "ease-in-out" });
  };

  for (const item of items) {
    must<HTMLButtonElement>(item, ".service-button").addEventListener("click", () => {
      const wasOpen = item.dataset["open"] === "true";
      for (const other of items) if (other !== item) close(other);
      if (wasOpen) close(item);
      else open(item);
    });
  }
}
