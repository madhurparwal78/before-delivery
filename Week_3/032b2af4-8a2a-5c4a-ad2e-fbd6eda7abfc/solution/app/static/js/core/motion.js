/** A fresh media query each call: reading `.matches` of one long-lived list can swallow its change events. */
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const OVERSHOOT = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Elements below the fold rise 16px and fade in when they enter view (500 ms, small overshoot).
 * A requestAnimationFrame loop compares each element's position with the viewport, so the entrance starts in the
 * frame that follows the scroll; elements stay at rest until then.
 */
export function revealOnView(elements) {
  if (reducedMotion()) return;
  let pending = elements.filter((el) => el.getBoundingClientRect().top > innerHeight);
  const frame = () => {
    pending = pending.filter((el) => {
      if (el.getBoundingClientRect().top > innerHeight - 24) return true;
      el.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }],
        { duration: 500, easing: OVERSHOOT });
      return false;
    });
    if (pending.length) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
