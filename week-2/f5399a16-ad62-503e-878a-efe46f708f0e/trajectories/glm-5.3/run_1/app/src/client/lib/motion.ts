// Motion: the published durations only — 160, 320 and 640 ms, plus the 64 s
// client strip. Everything is a browser-run transition or animation; only
// playback's frame stepping is stepped by script.

export const DURATION_FAST = 160;
export const DURATION_BASE = 320;
export const DURATION_SLOW = 640;
export const STRIP_PASS = 64000;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Under reduced motion there is no wipe at all: the new page is in place at
// once.
export async function withWipe(place: () => Promise<void>): Promise<void> {
  if (prefersReducedMotion()) {
    await place();
    return;
  }
  const panel = document.createElement("div");
  panel.setAttribute("data-part", "route-wipe");
  panel.style.position = "fixed";
  panel.style.inset = "0";
  panel.style.zIndex = "60";
  panel.style.background = "#c0271b";
  panel.style.transform = "skewY(-18deg) translateX(-100%)";
  panel.style.transition = `transform ${DURATION_BASE}ms ease-out`;
  document.body.appendChild(panel);
  await animate(panel, [{ transform: "skewY(-18deg) translateX(-100%)" }, { transform: "skewY(-18deg) translateX(0%)" }], DURATION_BASE);
  await place();
  await animate(panel, [{ transform: "skewY(-18deg) translateX(0%)" }, { transform: "skewY(-18deg) translateX(100%)" }], DURATION_BASE);
  panel.remove();
}

export function animate(el: Element, frames: Keyframe[], duration: number): Promise<void> {
  return new Promise((resolve) => {
    if (prefersReducedMotion()) {
      resolve();
      return;
    }
    const effect = new KeyframeEffect(el, frames, { duration, easing: "ease-out", fill: "forwards" });
    const player = new Animation(effect);
    player.onfinish = () => resolve();
    player.play();
  });
}
