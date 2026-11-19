import { PROJECT_TYPES, TITLES } from "../shared/copy.js";
import { isCategory } from "../shared/rules.js";
import { initCase } from "./case.js";
import { all, EASE_CARRY, EASE_OUT, layoutTop, must, reducedMotion, setHash } from "./dom.js";
import { initHome } from "./home.js";
import { jumpTo } from "./jump.js";
import { runScrollListeners } from "./scroll.js";

type View = "home" | "case" | "page";
type Entry = "carry" | "slide" | "pop";

interface RouteState {
  view: View;
  workItem?: string;
}

const CARRY_MS = 480;
const SLIDE_MS = 360;
const SLIDE_PX = 40;
const TITLE_MS = 180;
const TITLE_STAGGER_MS = 60;

let homeMain: HTMLElement | null = null;
let homeControls: ReturnType<typeof initHome> | null = null;
let busy = false;

const mainElement = (): HTMLElement => must<HTMLElement>(document, "main");
const viewOf = (): View => (mainElement().dataset["view"] as View | undefined) ?? "page";

async function fetchPage(url: URL): Promise<{ main: HTMLElement; title: string }> {
  const response = await fetch(url.pathname + url.search);
  if (!response.ok) throw new Error(String(response.status));
  const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
  return { main: document.adoptNode(must<HTMLElement>(parsed, "main")), title: parsed.title };
}

function swap(incoming: HTMLElement, title: string): void {
  mainElement().replaceWith(incoming);
  document.title = title;
}

function riseLines(lines: HTMLElement[], delay: number): void {
  lines.forEach((line, index) => {
    line.animate(
      [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }],
      { duration: TITLE_MS, delay: delay + index * TITLE_STAGGER_MS, easing: EASE_OUT, fill: "backwards" },
    );
  });
}

/** Moves an element from another box to its own by animating translate and scale from its top-left corner. */
function carryFrom(element: HTMLElement, from: DOMRect): void {
  const to = element.getBoundingClientRect();
  const transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  element.animate([{ transform }, { transform: "none" }], { duration: CARRY_MS, easing: EASE_CARRY });
}

function slide(ghost: HTMLElement, hero: HTMLElement, direction: number): void {
  const box = hero.getBoundingClientRect();
  Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  document.body.append(ghost);
  const leaving = ghost.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-direction * SLIDE_PX}px)` }],
    { duration: SLIDE_MS, easing: EASE_CARRY, fill: "forwards" },
  );
  void leaving.finished.then(() => ghost.remove(), () => ghost.remove());
  hero.animate(
    [{ opacity: 0, transform: `translateX(${direction * SLIDE_PX}px)` }, { opacity: 1, transform: "none" }],
    { duration: SLIDE_MS, easing: EASE_CARRY },
  );
}

async function showCase(url: URL, entry: Entry, anchor: HTMLElement | null): Promise<void> {
  const page = await fetchPage(url);
  const current = mainElement();
  const oldHero = current.querySelector<HTMLElement>("[data-hero]");
  const workItem = anchor?.closest<HTMLElement>("[data-project]") ?? null;
  const cover = workItem?.querySelector<HTMLElement>("[data-cover]") ?? null;
  const coverBox = entry === "carry" ? cover?.getBoundingClientRect() : undefined;
  const direction = anchor?.dataset["direction"] === "previous" ? -1 : 1;
  const ghost = entry === "slide" && oldHero ? (oldHero.cloneNode(true) as HTMLElement) : null;
  if (ghost) {
    ghost.classList.add("carry-ghost");
    ghost.removeAttribute("role");
    ghost.removeAttribute("aria-label");
    ghost.setAttribute("aria-hidden", "true");
  }
  if (viewOf() === "home") {
    current.dataset["entry"] = "resumed";
    const slug = workItem?.dataset["project"];
    if (slug) history.replaceState({ view: "home", workItem: slug } satisfies RouteState, "", location.href);
  }
  if (entry !== "pop") history.pushState({ view: "case" } satisfies RouteState, "", url);
  page.main.dataset["entry"] = entry;
  swap(page.main, page.title);
  scrollTo(0, 0);
  initCase(page.main);
  must<HTMLElement>(page.main, "h1").focus({ preventScroll: true });
  runScrollListeners();
  if (reducedMotion()) return;
  const hero = must<HTMLElement>(page.main, "[data-hero]");
  let delay = 0;
  if (coverBox) {
    carryFrom(hero, coverBox);
    delay = CARRY_MS;
  } else if (ghost) {
    slide(ghost, hero, direction);
    delay = SLIDE_MS;
  }
  riseLines(all<HTMLElement>(page.main, "[data-title-line]"), delay);
}

function placeWorkItem(workItem: HTMLElement): void {
  const available = innerHeight - 64;
  const space = Math.max(16, (available - workItem.offsetHeight) / 2);
  scrollTo(0, Math.max(0, layoutTop(workItem) - 64 - space));
}

async function showHome(url: URL, entry: "push" | "pop"): Promise<void> {
  const hero = mainElement().querySelector<HTMLElement>("[data-hero]");
  const heroBox = hero?.getBoundingClientRect();
  let main = entry === "pop" ? homeMain : null;
  let title: string = TITLES.home;
  if (main === null) {
    const page = await fetchPage(url);
    main = page.main;
    main.dataset["entry"] = "swap";
    title = page.title;
  }
  if (entry === "push") history.pushState({ view: "home" } satisfies RouteState, "", url);
  swap(main, title);
  if (main !== homeMain) {
    homeMain = main;
    homeControls = initHome(main);
  }
  const state = history.state as RouteState | null;
  const workItem = state?.workItem ? main.querySelector<HTMLElement>(`[data-project="${state.workItem}"]`) : null;
  const heading = url.hash.length > 1 ? document.getElementById(`${url.hash.slice(1)}-title`) : null;
  if (workItem && entry === "pop") {
    placeWorkItem(workItem);
    const link = must<HTMLElement>(workItem, ".work-item-title a");
    link.focus({ preventScroll: true });
    const cover = must<HTMLElement>(workItem, "[data-cover]");
    if (heroBox && !reducedMotion()) carryFrom(cover, heroBox);
  } else if (heading) {
    jumpTo(heading, true);
  } else {
    scrollTo(0, 0);
    must<HTMLElement>(main, "h1").focus({ preventScroll: true });
  }
  runScrollListeners();
}

/** A link to the home page while on it: set the filter or project type it names, then jump to its section. */
function followHomeLink(url: URL): void {
  const controls = homeControls;
  if (controls === null) return;
  const category = url.searchParams.get("category");
  if (isCategory(category)) controls.chooseCategory(category, true);
  const type = PROJECT_TYPES.find((option) => option.id === url.searchParams.get("type"))?.id;
  if (type !== undefined) controls.chooseType(type);
  const id = url.hash.slice(1);
  const heading = id === "" ? null : document.getElementById(`${id}-title`);
  if (heading === null) {
    scrollTo({ top: 0, behavior: reducedMotion() ? "instant" : "smooth" });
    setHash(null);
    return;
  }
  setHash(id);
  jumpTo(heading, false, type === undefined ? undefined : () => controls.field("name").focus());
}

async function guarded(work: () => Promise<void>, fallback: URL): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await work();
  } catch {
    location.assign(fallback);
  } finally {
    busy = false;
  }
}

/** Follows a link inside the same document when the site handles it; false leaves it to the browser. */
export function handleLink(anchor: HTMLAnchorElement): boolean {
  const url = new URL(anchor.href);
  const view = viewOf();
  if (url.origin !== location.origin || view === "page") return false;
  if (url.pathname.startsWith("/work/")) {
    void guarded(() => showCase(url, view === "home" ? "carry" : "slide", anchor), url);
    return true;
  }
  if (url.pathname !== "/") return false;
  if (view === "home") followHomeLink(url);
  else void guarded(() => showHome(url, "push"), url);
  return true;
}

function neighbour(direction: "previous" | "next"): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(`.more-link[data-direction="${direction}"]`);
}

export function initRouter(): void {
  history.scrollRestoration = "manual";
  history.replaceState({ view: viewOf(), ...(history.state as object | null) } satisfies RouteState, "");
  if (viewOf() === "home") {
    homeMain = mainElement();
    homeControls = initHome(homeMain);
  } else if (viewOf() === "case") {
    initCase(mainElement());
  }
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (anchor === null || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    if (handleLink(anchor)) event.preventDefault();
  });
  addEventListener("popstate", (event) => {
    const state = event.state as RouteState | null;
    const url = new URL(location.href);
    if (state === null) {
      const heading = url.hash.length > 1 ? document.getElementById(`${url.hash.slice(1)}-title`) : null;
      if (heading) jumpTo(heading, true);
      return;
    }
    if (url.pathname === "/") void guarded(() => showHome(url, "pop"), url);
    else void guarded(() => showCase(url, "pop", null), url);
  });
  document.addEventListener("keydown", (event) => {
    if (viewOf() !== "case" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable], [role=radio], [role=radiogroup], [role=tab], [role=tablist]")) return;
    const link = neighbour(event.key === "ArrowLeft" ? "previous" : "next");
    if (link) handleLink(link);
  });
}
