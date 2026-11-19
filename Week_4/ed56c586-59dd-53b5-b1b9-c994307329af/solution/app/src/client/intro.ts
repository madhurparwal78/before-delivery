import { prefersReducedMotion } from "./dom.js";

/** The hero intro: `data-intro` is `playing` from load and `done` from 1,800 ms of page time. Any key, pointer press,
 * wheel turn or scroll ends it at once. A hash, a `category` or `service` parameter, or reduced motion starts it done. */

const INTRO_MS = 1800;

export function initIntro(section: HTMLElement, onDone: () => void): void {
  if (section.dataset["intro"] === "done" || window.location.hash !== "" || prefersReducedMotion()) {
    endIntro(section);
    onDone();
    return;
  }
  const endEvents = ["keydown", "pointerdown", "wheel", "scroll"] as const;
  let timer = 0;
  const finish = (): void => {
    if (section.dataset["intro"] === "done") return;
    window.clearTimeout(timer);
    endIntro(section);
    for (const name of endEvents) window.removeEventListener(name, finish);
    onDone();
  };
  for (const name of endEvents) window.addEventListener(name, finish, { passive: true });
  timer = window.setTimeout(finish, INTRO_MS);
}

export function endIntro(section: HTMLElement): void {
  section.dataset["intro"] = "done";
}
