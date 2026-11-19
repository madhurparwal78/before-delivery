import { SECTIONS } from "../shared/copy.js";
import { all, layoutTop, reducedMotion } from "./dom.js";

/** The header and menu link of the section holding the point 40% down the viewport is the current one. */
function updateCurrent(main: HTMLElement): void {
  const point = innerHeight * 0.4;
  let current: string | null = null;
  for (const id of SECTIONS) {
    const section = main.querySelector<HTMLElement>(`#${id}`);
    const box = section?.getBoundingClientRect();
    if (box && box.top <= point && box.bottom > point) current = id === "intro" ? null : id;
  }
  for (const link of all<HTMLElement>(document, "[data-section-link]")) {
    const reachable = link.closest("dialog:not([open])") === null;
    if (reachable && main.dataset["view"] === "home" && link.dataset["sectionLink"] === current) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

/** The intro plate sits down by 0.25 of the scroll, capped at 800 px, and returns exactly. */
function updateParallax(main: HTMLElement): void {
  const plate = main.querySelector<HTMLElement>("[data-parallax]");
  if (!plate || reducedMotion()) return;
  plate.style.transform = `translateY(${Math.floor(0.25 * Math.min(scrollY, 800) + 0.5)}px)`;
}

/** Headings and covers reveal once, the first time their top edge is above 85% and 90% of the viewport. */
function reveal(main: HTMLElement): void {
  const items: [string, number][] = [[".reveal-heading", 0.85], [".work-item-cover", 0.9]];
  for (const [selector, edge] of items) {
    for (const element of all<HTMLElement>(main, `${selector}:not(.is-revealed):not(.is-done)`)) {
      if (element.offsetParent === null) continue;
      const top = layoutTop(element) - scrollY;
      if (top >= innerHeight * edge) continue;
      if (reducedMotion() || top + element.offsetHeight <= 0) {
        element.classList.add("is-done");
        continue;
      }
      element.classList.add("is-revealed");
      element.addEventListener("animationend", () => element.classList.replace("is-revealed", "is-done"), { once: true });
    }
  }
}

export function updateScrollEffects(): void {
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  if (main.dataset["view"] === "home") updateParallax(main);
  updateCurrent(main);
  reveal(main);
}
