/**
 * The Callout Thread: the signature interaction. Selecting a callout outlines
 * its region, steps the preview frame through its range on the page clock,
 * shows the readout and keeps the selection in the address.
 */
import {
  ANNOUNCEMENTS,
  CALLOUT_STEP_MS,
  PROJECTS_BY_SLUG,
  frameKey,
} from "../shared/domain.js";
import { announce, prefersReducedMotion, qs, qsa } from "./core.js";

type CalloutState = {
  slug: string;
  selected: number | null;
  timer: number;
  frame: number;
};

let state: CalloutState | null = null;

export function initCallouts(): void {
  const preview = qs<HTMLElement>("[data-preview]");
  if (!preview || !document.body.classList.contains("page-case")) return;
  const slug = document.body.dataset.slug ?? currentSlug();
  const project = PROJECTS_BY_SLUG.get(slug);
  if (!project) return;
  state = { slug, selected: null, timer: 0, frame: 1 };

  const img = qs<HTMLImageElement>("[data-case-frame-img]", preview);
  const region = qs<HTMLElement>("[data-callout-region]", preview);
  const readout = qs<HTMLElement>("[data-readout]", preview);
  const frameSlot = qs<HTMLElement>("[data-case-frame]", preview);
  const buttons = qsa<HTMLButtonElement>("[data-callout-button]", preview);
  if (!img || !region || !readout || !frameSlot || buttons.length === 0) return;

  const setFrame = (frame: number, crossfade: boolean): void => {
    if (!state) return;
    state.frame = frame;
    frameSlot.dataset.frame = String(frame);
    const key = frameKey(slug, frame);
    frameSlot.dataset.mediaSlot = key;
    frameSlot.dataset.mediaName = `${project.title}, frame ${frame} of 6`;
    img.alt = `${project.title}, frame ${frame} of 6`;
    if (crossfade && !prefersReducedMotion()) {
      img.dataset.crossfade = "true";
      window.setTimeout(() => img.removeAttribute("data-crossfade"), 220);
    }
    img.src = `/media/${key}`;
  };

  const clearStepping = (): void => {
    if (!state) return;
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = 0;
  };

  const showRegion = (index: number, instant: boolean): void => {
    const callout = project.callouts[index - 1];
    if (!callout) return;
    region.hidden = false;
    region.style.left = `${callout.region.left}%`;
    region.style.top = `${callout.region.top}%`;
    region.style.width = `${callout.region.width}%`;
    region.style.height = `${callout.region.height}%`;
    if (!instant && !prefersReducedMotion()) {
      region.dataset.drawing = "true";
      window.setTimeout(() => region.removeAttribute("data-drawing"), 320);
    }
  };

  const select = (index: number, options: { fromLoad?: boolean; announceIt?: boolean } = {}): void => {
    if (!state) return;
    const callout = project.callouts[index - 1];
    if (!callout) return;
    clearStepping();
    state.selected = index;
    preview.dataset.callout = String(index);
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        Number(button.dataset.calloutIndex) === index ? "true" : "false"
      );
    }
    showRegion(index, Boolean(options.fromLoad));
    readout.textContent = `Callout ${index} of 3 · frames ${callout.from}–${callout.to}`;
    const url = new URL(window.location.href);
    url.searchParams.set("callout", String(index));
    window.history.replaceState({}, "", url);
    if (options.announceIt) announce(ANNOUNCEMENTS.callout(index, callout.label));
    if (prefersReducedMotion() || options.fromLoad) {
      setFrame(callout.to, false);
      return;
    }
    setFrame(callout.from, true);
    let next = callout.from;
    const step = (): void => {
      if (!state || state.selected !== index) return;
      next += 1;
      if (next > callout.to) return;
      setFrame(next, true);
      state.timer = window.setTimeout(step, CALLOUT_STEP_MS);
    };
    state.timer = window.setTimeout(step, CALLOUT_STEP_MS);
  };

  const clear = (announceIt: boolean): void => {
    if (!state) return;
    clearStepping();
    state.selected = null;
    delete preview.dataset.callout;
    for (const button of buttons) button.setAttribute("aria-pressed", "false");
    region.hidden = true;
    readout.textContent = "No callout selected";
    const url = new URL(window.location.href);
    url.searchParams.delete("callout");
    window.history.replaceState({}, "", url);
    setFrame(1, false);
    if (announceIt) announce(ANNOUNCEMENTS.calloutCleared);
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.calloutIndex);
      if (state?.selected === index) clear(true);
      else select(index, { announceIt: true });
    });
  }

  preview.addEventListener("keydown", (event) => {
    if (!state) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLButtonElement)) return;
    if (!(focused.dataset.calloutIndex)) return;
    const index = Number(focused.dataset.calloutIndex);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      if (index < 3) {
        const target = buttons.find((b) => Number(b.dataset.calloutIndex) === index + 1);
        target?.focus({ preventScroll: true });
        select(index + 1, { announceIt: true });
      }
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (index > 1) {
        const target = buttons.find((b) => Number(b.dataset.calloutIndex) === index - 1);
        target?.focus({ preventScroll: true });
        select(index - 1, { announceIt: true });
      }
    }
  });

  const params = new URL(window.location.href).searchParams;
  const requested = params.get("callout");
  if (requested && Number(requested) >= 1 && Number(requested) <= 3) {
    select(Number(requested), { fromLoad: true });
  } else if (requested) {
    const url = new URL(window.location.href);
    url.searchParams.delete("callout");
    window.history.replaceState({}, "", url);
  }
}

function currentSlug(): string {
  const match = /\/work\/([a-z0-9-]+)/.exec(window.location.pathname);
  return match ? match[1] : "";
}
