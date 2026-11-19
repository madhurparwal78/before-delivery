import { CALLOUT_CLEARED, calloutAnnouncement } from "../shared/announcements.js";
import { CALLOUT_PARAM, CALLOUT_STEP_MS, NO_CALLOUT_READOUT, calloutFrameAt, calloutReadout, parseCalloutParam } from "../shared/callout.js";
import { knownProject } from "../shared/catalog.js";
import { announce } from "./announce.js";
import { currentParams, replaceAddress } from "./address.js";
import { all, must, prefersReducedMotion } from "./dom.js";
import { FramePlayer } from "./frames.js";

/** The Callout Thread. Selecting a callout outlines its region, shows its first frame at once and steps one frame every
 * 150 ms of page time to its last. Selecting it again clears everything. */

export function initCallouts(player: FramePlayer): void {
  const preview = must<HTMLElement>(document, "[data-preview]");
  const region = must<HTMLElement>(preview, "[data-callout-region]");
  const readout = must<HTMLElement>(preview, "[data-readout]");
  const buttons = all<HTMLButtonElement>(preview, "[data-callout-button]");
  const project = knownProject(must<HTMLElement>(document, "[data-case-study]").dataset["caseStudy"] ?? "");
  let selected: number | undefined;
  let stepTimer = 0;

  const stepTo = (callout: (typeof project.callouts)[number], elapsedMs: number): void => {
    player.show(calloutFrameAt(callout, elapsedMs));
    if (calloutFrameAt(callout, elapsedMs) < callout.lastFrame) {
      stepTimer = window.setTimeout(() => stepTo(callout, elapsedMs + CALLOUT_STEP_MS), CALLOUT_STEP_MS);
    }
  };

  const reflect = (number: number | undefined): void => {
    selected = number;
    window.clearTimeout(stepTimer);
    buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(index + 1 === number)));
    if (number === undefined) {
      delete preview.dataset["callout"];
      region.hidden = true;
      readout.textContent = NO_CALLOUT_READOUT;
      player.show(1);
      return;
    }
    const callout = project.callouts[number - 1];
    preview.dataset["callout"] = String(number);
    const [left, top, width, height] = callout.region;
    Object.assign(region.style, { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` });
    region.hidden = false;
    readout.textContent = calloutReadout(number, callout);
  };

  const select = (number: number): void => {
    const callout = project.callouts[number - 1];
    reflect(number);
    if (prefersReducedMotion()) player.show(callout.lastFrame);
    else {
      player.show(callout.firstFrame);
      stepTo(callout, 0);
    }
    replaceAddress((params) => params.set(CALLOUT_PARAM, String(number)));
    announce(calloutAnnouncement(number, callout));
  };

  const clear = (): void => {
    reflect(undefined);
    replaceAddress((params) => params.delete(CALLOUT_PARAM));
    announce(CALLOUT_CLEARED);
  };

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => (selected === index + 1 ? clear() : select(index + 1)));
    button.addEventListener("keydown", (event) => {
      const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
      const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
      if (!forward && !backward) return;
      event.preventDefault();
      const targetIndex = index + (forward ? 1 : -1);
      const target = buttons[targetIndex];
      if (target === undefined) return;
      target.focus();
      select(targetIndex + 1);
    });
  });

  const requested = parseCalloutParam(currentParams().get(CALLOUT_PARAM));
  const asked = currentParams().has(CALLOUT_PARAM);
  if (requested !== undefined) {
    reflect(requested);
    player.show(project.callouts[requested - 1].lastFrame);
  } else if (asked) {
    replaceAddress((params) => params.delete(CALLOUT_PARAM));
  }

  // A callout chosen while this script was still loading (the head buffers those clicks) is applied now.
  const early = window as unknown as { __calloutsReady?: boolean; __earlyCallouts?: HTMLButtonElement[] };
  early.__calloutsReady = true;
  (early.__earlyCallouts ?? []).splice(0).forEach((button) => {
    if (buttons.includes(button)) button.click();
  });
}
