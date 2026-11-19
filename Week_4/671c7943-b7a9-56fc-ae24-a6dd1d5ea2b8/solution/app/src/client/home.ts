import { CATEGORY_NAMES, filterAnnouncement } from "../shared/copy.js";
import { digitSpans, formatNumber, isCategory, sequenceOf } from "../shared/rules.js";
import type { CategoryId } from "../shared/types.js";
import { all, announce, EASE_OUT, layoutTop, must, reducedMotion, setParam } from "./dom.js";
import { initEnquiry } from "./enquiry.js";
import { onScroll } from "./scroll.js";

const COUNT_MS = 1200;

/** Roving tabs: arrow keys, Home and End select at once and wrap; the panel is not a tab stop. */
function initTabs(tablist: HTMLElement, onSelect?: (panel: HTMLElement) => void): void {
  const tabs = all<HTMLElement>(tablist, '[role="tab"]');
  const panels = tabs.map((tab) => must<HTMLElement>(document, `#${tab.getAttribute("aria-controls") ?? ""}`));
  const select = (index: number, focus: boolean): void => {
    tabs.forEach((tab, position) => {
      tab.setAttribute("aria-selected", String(position === index));
      tab.tabIndex = position === index ? 0 : -1;
    });
    panels.forEach((panel, position) => {
      panel.hidden = position !== index;
      if (position === index) onSelect?.(panel);
    });
    if (focus) tabs[index]?.focus();
  };
  tabs.forEach((tab, index) => tab.addEventListener("click", () => select(index, false)));
  tablist.addEventListener("keydown", (event) => {
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    const moves: Record<string, number> = {
      ArrowRight: (current + 1) % tabs.length,
      ArrowLeft: (current - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = moves[event.key];
    if (current === -1 || next === undefined) return;
    event.preventDefault();
    select(next, true);
  });
}

let counted = false;

/** The statistics count from 0 to their values over 1,200 ms on the page clock, once per page load. */
function initCount(tablist: HTMLElement): void {
  if (reducedMotion() || counted) return;
  const numbers = all<HTMLElement>(tablist, "[data-count]");
  const paint = (progress: number): void => {
    for (const number of numbers) {
      const value = Number(number.dataset["count"]);
      const shown = progress >= 1 ? value : Math.floor(value * (1 - (1 - progress) ** 3) + 0.5);
      number.innerHTML = digitSpans(formatNumber(shown));
    }
  };
  paint(0);
  let begun: number | null = null;
  const tick = (now: number): void => {
    begun ??= now;
    const progress = Math.min(1, (now - begun) / COUNT_MS);
    paint(progress);
    if (progress < 1) requestAnimationFrame(tick);
  };
  onScroll(() => {
    if (counted || tablist.getBoundingClientRect().top >= innerHeight * 0.85) return;
    counted = true;
    begun = performance.now();
    requestAnimationFrame(tick);
  });
}

function initStatistics(main: HTMLElement): void {
  const tablist = must<HTMLElement>(main, '[role="tablist"][aria-label="Statistics"]');
  initTabs(tablist);
  initCount(tablist);
}

function initProcess(main: HTMLElement): void {
  const tablist = must<HTMLElement>(main, '[role="tablist"][aria-label="Process"]');
  initTabs(tablist, (panel) => {
    if (reducedMotion()) return;
    panel.animate([{ opacity: 0, transform: "translateX(16px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: EASE_OUT });
  });
}

function initServices(main: HTMLElement): void {
  const services = all<HTMLElement>(main, ".service");
  const buttons = services.map((service) => must<HTMLButtonElement>(service, "button"));
  const setOpen = (open: CategoryId | null): void => {
    for (const service of services) {
      const isOpen = service.dataset["service"] === open;
      service.dataset["open"] = String(isOpen);
      must<HTMLElement>(service, "button").setAttribute("aria-expanded", String(isOpen));
    }
    setParam("service", open);
  };
  buttons.forEach((button, index) => {
    const id = services[index]?.dataset["service"] as CategoryId;
    button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") === "true" ? null : id));
    button.addEventListener("keydown", (event) => {
      const moves: Record<string, number> = {
        ArrowDown: (index + 1) % buttons.length,
        ArrowUp: (index - 1 + buttons.length) % buttons.length,
        Home: 0,
        End: buttons.length - 1,
      };
      const next = moves[event.key];
      if (next === undefined) return;
      event.preventDefault();
      buttons[next]?.focus();
    });
  });
  const opened = new URL(location.href).searchParams.get("service");
  const startOpen = buttons.find((button) => button.getAttribute("aria-expanded") === "true");
  if (startOpen && isCategory(opened)) {
    startOpen.focus({ preventScroll: true });
    scrollTo(0, Math.max(0, layoutTop(startOpen) - 96));
  }
}

function initFilter(main: HTMLElement): (category: CategoryId | null, announceChange: boolean) => void {
  const group = must<HTMLElement>(main, '[role="radiogroup"][aria-label="Filter work by service"]');
  const radios = all<HTMLInputElement>(group, "input");
  const workItems = all<HTMLElement>(main, "[data-project]").map((element) => ({ element, category: element.dataset["category"] as CategoryId }));
  const empty = must<HTMLElement>(main, "[data-empty]");
  const apply = (category: CategoryId | null, announceChange: boolean): void => {
    const shown = sequenceOf(workItems, category).map((entry) => entry.element);
    for (const { element } of workItems) {
      element.hidden = !shown.includes(element);
      const anchor = must<HTMLAnchorElement>(element, ".work-item-title a");
      const path = new URL(anchor.href).pathname;
      anchor.href = category === null ? path : `${path}?category=${category}`;
    }
    for (const radio of radios) radio.checked = radio.value === (category ?? "");
    const name = category === null ? null : CATEGORY_NAMES[category];
    empty.hidden = category === null || shown.length > 0;
    must<HTMLElement>(empty, "p").textContent = name === null || shown.length > 0 ? "" : filterAnnouncement(name, 0);
    setParam("category", category);
    if (!reducedMotion() && announceChange) {
      for (const element of shown) element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" });
    }
    if (announceChange) announce(filterAnnouncement(name, shown.length));
  };
  for (const radio of radios) {
    radio.addEventListener("change", () => {
      if (radio.checked) apply(isCategory(radio.value) ? radio.value : null, true);
    });
  }
  return apply;
}

export function initHome(main: HTMLElement) {
  initStatistics(main);
  initProcess(main);
  initServices(main);
  const chooseCategory = initFilter(main);
  initEnquiry(must<HTMLElement>(main, "[data-enquiry]"));
  return {
    chooseCategory,
    chooseType(id: string): void {
      const radio = main.querySelector<HTMLInputElement>(`input[name="project_type"][value="${id}"]`);
      if (radio) radio.checked = true;
      setParam("type", id);
    },
    field: (name: string) => must<HTMLElement>(main, `#field-${name}`),
  };
}
