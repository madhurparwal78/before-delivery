import type { Product } from "../../shared/content.js";
import { notice } from "../../shared/format.js";
import { createNitrateDiagram } from "../art/nitrate.js";
import { beetDrawing } from "../art/ornaments.js";
import { AMOUNTS_LINK, DISCLOSURES, NITRATE_STEPS, SCIENCE_LEAD, SCIENCE_TITLE } from "../copy.js";
import { h } from "../dom.js";
import { icon } from "../icons.js";

/** Science & Technology: three disclosures, the nitrate pathway slider and the not-a-medicine notice. */
export function createScience(product: Product, reveal: (heading: HTMLElement) => void): HTMLElement {
  const title = h("h2", { id: "science-title", tabindex: "-1" }, SCIENCE_TITLE);
  reveal(title);

  const disclosures = DISCLOSURES.map((entry, index) => {
    const panel = h("div", { class: "disclosure-panel", id: `disclosure-${index}`, hidden: true }, h("p", {}, entry.text));
    if (index === DISCLOSURES.length - 1) panel.append(h("a", { class: "text-link", href: "/#product" }, AMOUNTS_LINK, icon("arrow")));
    const button = h("button", { type: "button", class: "disclosure-button", "aria-expanded": "false", "aria-controls": panel.id }, entry.name, icon("chevron"));
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
    return h("div", { class: "disclosure" }, h("h3", {}, button), panel);
  });

  const diagram = createNitrateDiagram();
  const stepText = h("p", { class: "step-text", "aria-live": "off" }, NITRATE_STEPS[0].text);
  const slider = h("input", { id: "nitrate-slider", class: "slider", type: "range", min: 1, max: NITRATE_STEPS.length, step: 1, value: 1 });
  const show = (): void => {
    const step = Number(slider.value);
    const entry = NITRATE_STEPS[step - 1];
    slider.setAttribute("aria-valuetext", entry.name);
    stepText.textContent = entry.text;
    diagram.setStep(step);
  };
  slider.addEventListener("input", show);
  show();

  return h("section", { "data-chapter": "science", class: "chapter chapter-science paper", "aria-labelledby": "science-title" },
    h("div", { class: "spread" },
      h("div", { class: "spread-head" }, title, h("p", { class: "lead" }, SCIENCE_LEAD), beetDrawing()),
      h("div", { class: "disclosures" }, ...disclosures),
      h("div", { class: "pathway" },
        diagram.element,
        h("div", { class: "pathway-control" }, h("label", { class: "slider-label", for: "nitrate-slider" }, "Nitrate pathway"), slider, stepText)),
      h("p", { class: "notice" }, notice(product))));
}
