import { FOOTER_WAVE_LINE, reachedLine } from "../shared/scroll-lines.js";
import { all, must, play } from "./dom.js";
import { onViewportChange } from "./viewport.js";

/** The first time on a page load that the footer's top edge reaches the 90% line, the wordmark waves once. */

const LETTER_MS = 400;
const LETTER_STEP_MS = 40;
const LETTER_RISE_PX = 12;

export function initFooterWave(): void {
  const footer = must<HTMLElement>(document, "[data-footer]");
  const letters = all<HTMLElement>(footer, ".wordmark-letter");
  let waved = false;
  onViewportChange(() => {
    if (waved || !reachedLine(footer.getBoundingClientRect().top, window.innerHeight, FOOTER_WAVE_LINE)) return;
    waved = true;
    footer.dataset["waved"] = "true";
    letters.forEach((letter, index) => {
      play(letter, [{ transform: "translateY(0)" }, { transform: `translateY(${-LETTER_RISE_PX}px)` }, { transform: "translateY(0)" }], {
        duration: LETTER_MS,
        delay: LETTER_STEP_MS * index,
        easing: "ease-in-out",
      });
    });
  });
}
