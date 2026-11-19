import { isNarrow, must, prefersReducedMotion } from "./dom.js";
import { onViewportChange } from "./viewport.js";

/** Copy drift and sculpture tilt follow scroll and pointer directly. Both stay 0 under 768 px and with reduced motion. */

const DRIFT_SHARE = 0.3;
const DRIFT_CAP_PX = 600;
const TILT_MAX_DEGREES = 12;

function driftOffset(scrollY: number): number {
  return Math.round(DRIFT_SHARE * Math.min(scrollY, DRIFT_CAP_PX));
}

function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

function clampTilt(degrees: number): number {
  return Math.max(-TILT_MAX_DEGREES, Math.min(TILT_MAX_DEGREES, degrees));
}

function tiltOf(pointer: { readonly x: number; readonly y: number }, box: DOMRect): { readonly x: number; readonly y: number } {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  return {
    x: clampTilt(roundHalfAwayFromZero((-TILT_MAX_DEGREES * (pointer.y - centreY)) / (box.height / 2))),
    y: clampTilt(roundHalfAwayFromZero((TILT_MAX_DEGREES * (pointer.x - centreX)) / (box.width / 2))),
  };
}

export function initHeroMotion(): void {
  const intro = must<HTMLElement>(document, "#intro");
  const copy = must<HTMLElement>(intro, "[data-hero-copy]");
  const visual = must<HTMLElement>(intro, "[data-hero-visual]");
  const active = (): boolean => !isNarrow() && !prefersReducedMotion();
  let pointer: { x: number; y: number } | undefined;

  const setTilt = (x: number, y: number): void => {
    visual.dataset["tiltX"] = String(x);
    visual.dataset["tiltY"] = String(y);
    visual.style.transform = x === 0 && y === 0 ? "" : `rotateX(${x}deg) rotateY(${y}deg)`;
  };

  const followPointer = (): void => {
    if (!active() || pointer === undefined) {
      setTilt(0, 0);
      return;
    }
    const box = intro.getBoundingClientRect();
    const inside = pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom;
    const tilt = inside ? tiltOf(pointer, box) : { x: 0, y: 0 };
    setTilt(tilt.x, tilt.y);
  };

  onViewportChange(() => {
    copy.style.transform = active() && window.scrollY > 0 ? `translateY(${-driftOffset(window.scrollY)}px)` : "";
    followPointer();
  });
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    pointer = { x: event.clientX, y: event.clientY };
    followPointer();
  });
  document.documentElement.addEventListener("pointerleave", () => {
    pointer = undefined;
    followPointer();
  });
}
