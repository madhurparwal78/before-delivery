import { MILESTONE_LINE, reachedLine } from "../shared/scroll-lines.js";
import { all, must } from "./dom.js";
import { onViewportChange } from "./viewport.js";

/** The career journey: a milestone is reached while its top edge is at or above the 60% line; its button shows or hides
 * its one-sentence detail, and several details may be open at once. */

export function initJourney(): void {
  const journey = must<HTMLElement>(document, "[data-journey-progress]");
  const milestones = all<HTMLElement>(journey, "[data-milestone]");
  onViewportChange(() => {
    let reached = 0;
    for (const milestone of milestones) {
      const isReached = reachedLine(milestone.getBoundingClientRect().top, window.innerHeight, MILESTONE_LINE);
      milestone.dataset["reached"] = String(isReached);
      if (isReached) reached += 1;
    }
    journey.dataset["value"] = String(reached);
  });
  for (const milestone of milestones) {
    const button = must<HTMLButtonElement>(milestone, "button");
    const detail = must<HTMLElement>(milestone, ".milestone-detail");
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      detail.hidden = !open;
    });
  }
}
