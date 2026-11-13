import { announce } from "../announce.js";
import { panelArt } from "../art/ornaments.js";
import { ABOUT_LEAD, ABOUT_TITLE, PANELS } from "../copy.js";
import { h } from "../dom.js";
import { held, onHeldChange, reducedMotion } from "../motion.js";
import { PANEL_COUNT, heldGeometry, panelAt, panelAtScroll, panelProgress, progressText, share } from "./progress.js";

/**
 * Inner Pace: three panels in a track that follows the scroll on wide screens and is a snapping row elsewhere.
 * `mount` reads the layout once the chapter is in the document.
 */
export function createAbout(reveal: (heading: HTMLElement) => void, signal: AbortSignal) {
  const track = h("div", { class: "track", "data-track": "", role: "group", "aria-label": "Inner Pace panels" },
    ...PANELS.map((panel, index) =>
      h("article", { class: "panel" },
        panelArt(index),
        h("div", { class: "panel-text" },
          h("span", { class: "panel-number", "aria-hidden": "true" }, `0${index + 1}`),
          h("h3", {}, panel.title),
          h("p", {}, panel.text)))));
  const previous = h("button", { type: "button", class: "button button-quiet" }, "Previous panel");
  const next = h("button", { type: "button", class: "button" }, "Next panel");
  const counter = h("p", { class: "counter" }, `1 / ${PANEL_COUNT}`);
  const title = h("h2", { id: "about-title", tabindex: "-1" }, ABOUT_TITLE);
  reveal(title);
  const region = h("section", { "data-chapter": "about", class: "chapter chapter-about paper", "aria-labelledby": "about-title", "data-panel": "1" },
    h("div", { class: "held-frame" },
      title,
      h("p", { class: "lead" }, ABOUT_LEAD),
      h("div", { class: "panels" }, track),
      h("div", { class: "panel-controls" }, previous, counter, next)));

  let panel = 1;
  let announced = 1;
  let travelling = false;

  const setPanel = (value: number): void => {
    panel = value;
    region.dataset["panel"] = String(value);
    counter.textContent = `${value} / ${PANEL_COUNT}`;
    previous.disabled = value === 1;
    next.disabled = value === PANEL_COUNT;
  };

  const follow = (): void => {
    if (held()) {
      const { offset, travel } = heldGeometry(region);
      region.dataset["progress"] = progressText(offset, travel);
      track.style.setProperty("--progress", String(share(offset, travel)));
      setPanel(panelAt(offset, travel));
    } else if (!travelling) {
      setPanel(panelAtScroll(track.scrollLeft, track.clientWidth));
    }
  };

  const layout = (): void => {
    region.toggleAttribute("data-held", held());
    if (held()) {
      track.removeAttribute("tabindex");
    } else {
      track.tabIndex = 0;
      delete region.dataset["progress"];
      track.style.removeProperty("--progress");
    }
    follow();
    announced = panel;
  };

  const say = (value: number): void => {
    announced = value;
    announce(`Panel ${value} of ${PANEL_COUNT}: ${PANELS[value - 1].title}.`);
  };

  const go = (target: number, pressed: HTMLButtonElement, other: HTMLButtonElement): void => {
    if (held()) {
      const { travel, top } = heldGeometry(region);
      scrollTo({ top: top + panelProgress(target) * travel, behavior: "instant" });
      follow();
    } else {
      travelling = true;
      track.scrollTo({ left: (target - 1) * track.clientWidth, behavior: reducedMotion() ? "instant" : "smooth" });
      setPanel(target);
    }
    say(target);
    if (pressed.disabled) other.focus();
  };

  previous.addEventListener("click", () => go(panel - 1, previous, next));
  next.addEventListener("click", () => go(panel + 1, next, previous));

  addEventListener("scroll", follow, { passive: true, signal });
  track.addEventListener("scroll", follow, { passive: true, signal });
  /** A swipe settles on a panel and is announced once; a button press already announced its own panel. */
  track.addEventListener("scrollend", () => {
    travelling = false;
    follow();
    if (!held() && panel !== announced) say(panel);
  }, { signal });
  addEventListener("resize", follow, { signal });
  onHeldChange(layout, signal);
  return { element: region, mount: layout };
}
