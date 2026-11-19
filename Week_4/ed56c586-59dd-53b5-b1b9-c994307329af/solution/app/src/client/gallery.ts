import { DISCIPLINES, knownProject, type DisciplineValue } from "../shared/catalog.js";
import { CATEGORY_PARAM, applyCategories, caseStudyHref, galleryColumn, isPressed, needsCanonicalCategories, parseCategories, resultsText, toggleCategory, visibleProjects } from "../shared/filter.js";
import { announce } from "./announce.js";
import { currentParams, replaceAddress } from "./address.js";
import { all, isNarrow, must } from "./dom.js";
import { onViewportChange } from "./viewport.js";

/** The project gallery: discipline filter, result line, card links and the reveal of each card's cover. */

export interface Gallery {
  readonly categories: () => readonly DisciplineValue[];
}

export function initGallery(): Gallery {
  const section = must<HTMLElement>(document, "#work");
  const buttons = all<HTMLButtonElement>(section, "[data-filter]");
  const results = must<HTMLElement>(section, "[data-results]");
  const cards = all<HTMLElement>(section, "[data-project]");
  let categories = parseCategories(currentParams().get(CATEGORY_PARAM));

  const render = (): void => {
    const shown = visibleProjects(categories);
    for (const button of buttons) {
      const discipline = DISCIPLINES.find((candidate) => candidate.value === button.dataset["filter"]);
      button.setAttribute("aria-pressed", String(isPressed(categories, discipline?.value ?? "all")));
    }
    for (const card of cards) {
      const project = knownProject(card.dataset["project"] ?? "");
      const index = shown.indexOf(project);
      card.hidden = index < 0;
      card.dataset["col"] = String(galleryColumn(Math.max(index, 0)));
      must<HTMLAnchorElement>(card, "[data-card-link]").href = caseStudyHref(project.slug, categories);
    }
    results.textContent = resultsText(shown.length);
  };

  const change = (next: readonly DisciplineValue[]): void => {
    categories = next;
    render();
    for (const card of cards.filter((candidate) => !candidate.hidden)) {
      delete card.dataset["entering"];
      void card.offsetWidth;
      card.dataset["entering"] = "true";
    }
    replaceAddress((params) => applyCategories(params, categories));
    announce(results.textContent ?? "");
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const value = button.dataset["filter"];
      const discipline = DISCIPLINES.find((candidate) => candidate.value === value);
      change(discipline === undefined ? [] : toggleCategory(categories, discipline.value));
    });
  }

  const raw = currentParams().get(CATEGORY_PARAM);
  if (needsCanonicalCategories(raw)) {
    replaceAddress((params) => applyCategories(params, categories));
  }
  render();

  const revealers = cards.map((card) => {
    let hovered = false;
    let focused = false;
    const update = (): void => {
      card.dataset["revealed"] = String(hovered || focused || isNarrow());
    };
    card.addEventListener("pointerenter", (event) => {
      hovered = event.pointerType !== "touch";
      update();
    });
    card.addEventListener("pointerleave", () => {
      hovered = false;
      update();
    });
    card.addEventListener("focusin", () => {
      focused = true;
      update();
    });
    card.addEventListener("focusout", (event) => {
      focused = event.relatedTarget instanceof Node && card.contains(event.relatedTarget);
      update();
    });
    update();
    return update;
  });
  onViewportChange(() => revealers.forEach((update) => update()));

  return { categories: () => categories };
}
