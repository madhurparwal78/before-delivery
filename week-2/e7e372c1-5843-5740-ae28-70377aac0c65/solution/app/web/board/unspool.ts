// Unspool choreography. Sequenced motion uses element.animate() only; geometry is measured from the
// settled layout so a thread never aims at a panel that is still sliding in.

import type { Computation, ComputationInput } from "../../shared/domain.ts";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const SPREAD_MS = 250;
const PANEL_MS = 250;
const PANEL_DELAY_MS = 167;
const THREAD_MS = 400;

function isFiled(input: ComputationInput): boolean {
  return input.source.kind === "exhibit";
}

export function filedInputs(computation: Computation): ComputationInput[] {
  return computation.inputs.filter(isFiled);
}

export function neighbour(computation: Computation, selected: string, step: 1 | -1): string {
  const keys = computation.inputs.map((input) => input.key);
  const index = Math.max(0, keys.indexOf(selected));
  return keys[(index + step + keys.length) % keys.length] ?? selected;
}

function centre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function chipElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-unspool-chip]"));
}

function threadElements(): SVGPathElement[] {
  return Array.from(document.querySelectorAll<SVGPathElement>("path[data-unspool-thread]"));
}

/** Points every thread from its chip to its own exhibit row, measured as if the panel had finished sliding. */
export function anchorThreads(panel: HTMLElement): void {
  const slide = Math.max(0, panel.getBoundingClientRect().left - (window.innerWidth - panel.offsetWidth));
  for (const path of threadElements()) {
    const key = path.dataset["unspoolThread"] ?? "";
    const chip = document.querySelector<HTMLElement>(`[data-unspool-chip="${key}"]`);
    const row = panel.querySelector<HTMLElement>(`[data-row-key="${key}"]`);
    if (!chip || !row) continue;
    const from = chip.getBoundingClientRect();
    const to = row.getBoundingClientRect();
    const x1 = from.left + from.width / 2;
    const y1 = from.bottom - 6;
    const x2 = to.left - slide + 6;
    const y2 = to.top + to.height / 2;
    const drop = Math.max(36, Math.abs(y2 - y1) / 3);
    const reach = Math.max(48, Math.abs(x2 - x1) / 2);
    path.setAttribute("d", `M${x1.toFixed(1)} ${y1.toFixed(1)} C${x1.toFixed(1)} ${(y1 + drop).toFixed(1)} ${(x2 - reach).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
  }
}

function settled(animations: Animation[]): Promise<void> {
  return Promise.allSettled(animations.map((animation) => animation.finished)).then(() => undefined);
}

/** Split and spread, then the panel and threads from a sixth of a second in. Resolves when all have finished. */
export function playOpening(panel: HTMLElement, numeral: Element | null, sliding: "right" | "bottom", withThreads: boolean): Promise<void> {
  const animations: Animation[] = [];
  const origin = numeral ? centre(numeral.getBoundingClientRect()) : null;
  for (const chip of chipElements()) {
    const here = centre(chip.getBoundingClientRect());
    const dx = origin ? origin.x - here.x : 0;
    const dy = origin ? origin.y - here.y : 0;
    animations.push(chip.animate([{ transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0 }, { transform: "translate(0, 0) scale(1)", opacity: 1 }], { duration: SPREAD_MS, easing: EASE, fill: "backwards" }));
  }
  animations.push(panel.animate([{ transform: sliding === "right" ? "translateX(100%)" : "translateY(100%)" }, { transform: "translate(0, 0)" }], { duration: PANEL_MS, delay: PANEL_DELAY_MS, easing: EASE, fill: "backwards" }));
  if (withThreads) {
    for (const path of threadElements()) {
      animations.push(path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: THREAD_MS, delay: PANEL_DELAY_MS, easing: EASE, fill: "backwards" }));
    }
  }
  return settled(animations);
}

/** The opening in reverse: threads retract, the panel slides out, the chips gather back into the numeral. */
export function playClosing(panel: HTMLElement, numeral: Element | null, sliding: "right" | "bottom"): Promise<void> {
  const animations: Animation[] = [];
  const origin = numeral ? centre(numeral.getBoundingClientRect()) : null;
  for (const path of threadElements()) {
    animations.push(path.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], { duration: 300, easing: EASE, fill: "forwards" }));
  }
  animations.push(panel.animate([{ transform: "translate(0, 0)" }, { transform: sliding === "right" ? "translateX(100%)" : "translateY(100%)" }], { duration: PANEL_MS, delay: 100, easing: EASE, fill: "forwards" }));
  for (const chip of chipElements()) {
    const here = centre(chip.getBoundingClientRect());
    const dx = origin ? origin.x - here.x : 0;
    const dy = origin ? origin.y - here.y : 0;
    animations.push(chip.animate([{ transform: "translate(0, 0) scale(1)", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0 }], { duration: SPREAD_MS, delay: 150, easing: EASE, fill: "forwards" }));
  }
  return settled(animations);
}

export function cancelRunning(): void {
  for (const animation of document.getAnimations()) {
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    if (target instanceof Element && target.closest("[data-unspool-chip], [data-unspool-thread], .trace-panel")) animation.cancel();
  }
}
