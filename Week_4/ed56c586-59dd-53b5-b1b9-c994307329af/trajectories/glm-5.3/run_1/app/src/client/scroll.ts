/**
 * The current-section line, the career journey progress, the counters, the
 * footer wordmark and the custom cursor, all evaluated on scroll and resize.
 */
import {
  COUNTER_DURATION,
  counterFigure,
} from "../shared/domain.js";
import { prefersReducedMotion, qs, qsa } from "./core.js";
import { line40, line60, line75 } from "./scroll-rules.js";

const SECTION_IDS = ["about", "work", "services", "skills", "reviews", "contact"];
const CASE_SECTION_IDS = ["overview", "challenge", "solution", "decisions", "stack"];

type CounterState = {
  element: HTMLElement;
  value: HTMLElement;
  target: number;
  suffix: string;
  started: boolean;
  timer: number;
};

const counters: CounterState[] = [];

export function initScroll(): void {
  initCounters();
  applyScrollRules();
  window.addEventListener("scroll", () => applyScrollRules(), { passive: true });
  window.addEventListener("resize", () => applyScrollRules());
}

function applyScrollRules(): void {
  applyCurrentSection();
  applyMilestones();
  applyCounters();
  applyFooterWave();
}

function applyCurrentSection(): void {
  const isHome = document.body.classList.contains("page-home");
  const line = line40();
  let current: string | null = null;
  if (isHome) {
    for (const id of SECTION_IDS) {
      const element = document.getElementById(id);
      if (!element) continue;
      const top = element.getBoundingClientRect().top + window.scrollY;
      if (top <= line) current = id;
    }
    const about = document.getElementById("about");
    if (about && about.getBoundingClientRect().top + window.scrollY > line) current = null;
  } else {
    for (const id of CASE_SECTION_IDS) {
      const element = document.getElementById(id);
      if (!element) continue;
      const top = element.getBoundingClientRect().top + window.scrollY;
      if (top <= line) current = id;
    }
  }
  // exactly one link in Sections carries aria-current; the open menu mirrors it
  const headerLinks = qsa<HTMLElement>("[data-header-nav] [data-header-link]");
  for (const link of headerLinks) {
    if (link.dataset.headerLink === current) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
  const menuLinks = qsa<HTMLElement>("[data-menu-nav] [data-header-link]");
  for (const link of menuLinks) {
    if (link.dataset.headerLink === current) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
  const onThisPage = qsa<HTMLElement>("[data-on-this-page-link]");
  for (const link of onThisPage) {
    if (link.dataset.onThisPageLink === current) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
}

function applyMilestones(): void {
  const milestones = qsa<HTMLElement>("[data-milestone]");
  if (milestones.length === 0) return;
  const line = line60();
  let reached = 0;
  for (const milestone of milestones) {
    const top = milestone.getBoundingClientRect().top + window.scrollY;
    const isReached = top <= line;
    milestone.dataset.reached = isReached ? "true" : "false";
    if (isReached) reached += 1;
  }
  const progress = qs<HTMLElement>("[data-journey-progress]");
  if (progress) {
    progress.dataset.value = String(reached);
    const track = progress.querySelector<HTMLElement>("[data-journey-line]");
    if (track) track.style.height = `${(reached / milestones.length) * 100}%`;
  }
}

function initCounters(): void {
  const blocks = qsa<HTMLElement>("[data-stats]");
  for (const block of blocks) {
    const countersInBlock = qsa<HTMLElement>("[data-counter]", block);
    for (const element of countersInBlock) {
      const value = element.querySelector<HTMLElement>(".counter-value");
      if (!value) continue;
      counters.push({
        element,
        value,
        target: Number(element.dataset.target ?? "0"),
        suffix: element.dataset.suffix ?? "",
        started: false,
        timer: 0,
      });
    }
  }
}

function applyCounters(): void {
  const line = line75();
  for (const counter of counters) {
    if (counter.started) continue;
    const top = counter.element.closest<HTMLElement>("[data-stats]")?.getBoundingClientRect().top ?? 0;
    const blockTop = top + window.scrollY;
    if (blockTop <= line) startCounter(counter);
  }
}

function startCounter(counter: CounterState): void {
  counter.started = true;
  if (prefersReducedMotion()) {
    counter.element.dataset.state = "done";
    counter.value.textContent = `${counter.target}${counter.suffix}`;
    return;
  }
  counter.element.dataset.state = "counting";
  const startedAt = performance.now();
  const tick = (): void => {
    const elapsed = performance.now() - startedAt;
    const figure = counterFigure(counter.target, elapsed);
    counter.value.textContent = `${figure}${counter.suffix}`;
    if (elapsed >= COUNTER_DURATION) {
      counter.element.dataset.state = "done";
      counter.value.textContent = `${counter.target}${counter.suffix}`;
      return;
    }
    counter.timer = window.setTimeout(tick, 16);
  };
  tick();
}

/** The wordmark waves once, the first time the footer's top edge reaches the 90% line. */
function applyFooterWave(): void {
  const footer = qs<HTMLElement>("footer");
  if (!footer || footer.dataset.waved === "true") return;
  const top = footer.getBoundingClientRect().top;
  if (top <= window.innerHeight * 0.9) {
    footer.dataset.waved = "true";
  }
}

/** custom cursor: position follows the pointer directly, state by hover target */
export function initCursor(): void {
  const cursor = qs<HTMLElement>("[data-cursor]");
  const label = cursor?.querySelector<HTMLElement>("[data-cursor-text]");
  if (!cursor || !label) return;
  if (prefersReducedMotion()) {
    cursor.dataset.visible = "false";
    return;
  }
  let visible = false;
  const move = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      visible = false;
      cursor.dataset.visible = "false";
      return;
    }
    visible = true;
    cursor.dataset.visible = "true";
    cursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    const target = event.target instanceof Element ? event.target : null;
    let state = "default";
    let text = "";
    if (target) {
      const card = target.closest("[data-project]");
      const track = target.closest("[data-review-track]");
      const control = target.closest("a, button, [role='tab'], input, select, textarea, label, summary");
      if (card) {
        state = "view";
        text = "View";
      } else if (track) {
        state = "drag";
        text = "Drag";
      } else if (control) {
        state = "link";
      }
    }
    cursor.dataset.cursorState = state;
    label.textContent = text;
  };
  window.addEventListener("pointermove", move, { passive: true });
  const hide = (): void => {
    visible = false;
    cursor.dataset.visible = "false";
  };
  document.addEventListener("pointerleave", hide);
  window.addEventListener("blur", hide);
  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") hide();
  });
  if (!visible) cursor.dataset.visible = "false";
}
