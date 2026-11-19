import { SKILL_BARS_LINE, reachedLine } from "../shared/scroll-lines.js";
import { all, must } from "./dom.js";
import { onViewportChange } from "./viewport.js";

/** The skills explorer: tabs select on focus, only the selected panel shows, one technology detail is open per panel, and
 * each panel's bars grow every time it shows (for `Frontend`, the first time the section reaches the 75% line). */

export function initSkills(): void {
  const section = must<HTMLElement>(document, "#skills");
  const tabs = all<HTMLButtonElement>(section, "[role='tab']");
  const panels = all<HTMLElement>(section, "[role='tabpanel']");
  let frontendWaiting = true;

  const growBars = (panel: HTMLElement): void => {
    panel.dataset["bars"] = "off";
    void panel.offsetWidth;
    panel.dataset["bars"] = "play";
  };

  const select = (index: number, focus: boolean): void => {
    tabs.forEach((tab, at) => {
      tab.setAttribute("aria-selected", String(at === index));
      tab.tabIndex = at === index ? 0 : -1;
    });
    panels.forEach((panel, at) => {
      panel.hidden = at !== index;
    });
    const panel = panels[index];
    if (panel !== undefined) {
      frontendWaiting = false;
      growBars(panel);
    }
    if (focus) tabs[index]?.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index, false));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      const target: Record<string, number> = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last };
      const to = target[event.key];
      if (to === undefined) return;
      event.preventDefault();
      select(to, true);
    });
  });

  for (const panel of panels) {
    const cards = all<HTMLElement>(panel, "[data-skill]");
    for (const card of cards) {
      const button = must<HTMLButtonElement>(card, ".skill-button");
      button.addEventListener("click", () => {
        const open = button.getAttribute("aria-expanded") !== "true";
        for (const other of cards) {
          must<HTMLButtonElement>(other, ".skill-button").setAttribute("aria-expanded", "false");
          must<HTMLElement>(other, ".skill-detail").hidden = true;
        }
        button.setAttribute("aria-expanded", String(open));
        must<HTMLElement>(card, ".skill-detail").hidden = !open;
      });
    }
  }

  onViewportChange(() => {
    const frontend = panels[0];
    if (frontendWaiting && frontend !== undefined && reachedLine(section.getBoundingClientRect().top, window.innerHeight, SKILL_BARS_LINE)) {
      frontendWaiting = false;
      growBars(frontend);
    }
  });
}
