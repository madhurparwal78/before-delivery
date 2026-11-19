/**
 * Career journey milestones: each button shows or hides its detail, and several
 * details may be open at once. The reached flags are set by the scroll rules.
 */
import { qsa } from "./core.js";

export function initMilestones(): void {
  for (const toggle of qsa<HTMLButtonElement>(".milestone-toggle")) {
    toggle.addEventListener("click", () => {
      const detail = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
      if (!detail) return;
      const open = !detail.hidden;
      detail.hidden = open;
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
    });
  }
}
