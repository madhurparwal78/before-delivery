import { announce } from "../announce.js";
import { createOxygenDiagram } from "../art/oxygen.js";
import { OXYGEN_TITLE, STAGES } from "../copy.js";
import { h } from "../dom.js";
import { held, onHeldChange } from "../motion.js";
import { createTabs } from "../tabs.js";
import { STAGE_COUNT, heldGeometry, progressText, share, stageAt, stageProgress } from "./progress.js";

/**
 * Oxygen & Energy: the oxygen dot travels from the lungs to the cell with the scroll, or with the stage tabs.
 * `mount` places the dot once the chapter is in the document.
 */
export function createOxygen(reveal: (heading: HTMLElement) => void, signal: AbortSignal) {
  const diagram = createOxygenDiagram();
  const panels = STAGES.map((stage) => h("div", { class: "stage-panel" }, h("h3", {}, stage.title), h("p", {}, stage.text)));
  const tabs = createTabs({
    label: "Oxygen stages",
    id: "oxygen",
    names: STAGES.map((stage) => stage.name),
    panels,
    onChoose: (index) => choose(index + 1),
  });
  const title = h("h2", { id: "oxygen-title", tabindex: "-1" }, OXYGEN_TITLE);
  reveal(title);
  const region = h("section", { "data-chapter": "oxygen", class: "chapter chapter-oxygen night", "aria-labelledby": "oxygen-title", "data-stage": "1" },
    h("div", { class: "held-frame" },
      title,
      h("div", { class: "oxygen-figure" }, diagram.element),
      h("div", { class: "stage-choice" }, tabs.element, ...panels)));

  let stage = 1;

  const setStage = (value: number): void => {
    stage = value;
    region.dataset["stage"] = String(value);
    tabs.show(value - 1);
  };

  const follow = (): void => {
    if (held()) {
      const { offset, travel } = heldGeometry(region);
      region.dataset["progress"] = progressText(offset, travel);
      setStage(stageAt(offset, travel));
      diagram.place(share(offset, travel));
    } else {
      diagram.place(stageProgress(stage));
    }
  };

  function choose(value: number): void {
    if (held()) {
      const { travel, top } = heldGeometry(region);
      scrollTo({ top: top + stageProgress(value) * travel, behavior: "instant" });
    }
    setStage(value);
    follow();
    announce(`Stage ${value} of ${STAGE_COUNT}: ${STAGES[value - 1].title}.`);
  }

  const layout = (): void => {
    region.toggleAttribute("data-held", held());
    if (!held()) delete region.dataset["progress"];
    follow();
  };

  addEventListener("scroll", follow, { passive: true, signal });
  addEventListener("resize", follow, { signal });
  onHeldChange(layout, signal);
  return { element: region, mount: layout };
}
