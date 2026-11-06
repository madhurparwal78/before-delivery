// The way out of the page. State, focus and the accessibility tree move on at once, so an element
// that leaves plays its exit as a stripped, inert copy that nothing can reach or read. The copy sits
// in the original's parent, so anything that discards that parent, such as sign-out, discards it too.
import { useLayoutEffect, useRef, type RefObject } from "react";

/** Every motion in the app starts quickly and settles softly on this curve. */
export const SETTLE = "cubic-bezier(.16,1,.3,1)";

const EXITS = {
  sheet: { to: { transform: "translateX(24px)", opacity: 0 }, duration: 200, clipToParent: true },
  pop: { to: { transform: "translateY(-4px)", opacity: 0 }, duration: 160, clipToParent: false },
  notice: { to: { transform: "translateY(-100%)", opacity: 0 }, duration: 200, clipToParent: false },
};

function leave(node: HTMLElement, kind: keyof typeof EXITS): void {
  const parent = node.parentElement;
  const box = node.getBoundingClientRect();
  if (!parent || box.width === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { to, duration, clipToParent } = EXITS[kind];
  const frame = parent.getBoundingClientRect();
  const top = clipToParent ? Math.max(box.top, frame.top) : box.top;
  const bottom = clipToParent ? Math.min(box.bottom, frame.bottom) : box.bottom;

  const copy = node.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
    for (const name of ["id", "name", "role", "aria-label", "aria-labelledby", "aria-describedby", "data-chip", "data-drop-date"]) el.removeAttribute(name);
  }
  copy.classList.add("exit-copy");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  Object.assign(copy.style, { top: `${top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${bottom - top}px` });
  parent.append(copy);
  copy.scrollTop = top - box.top;
  copy.animate([{ transform: "none", opacity: 1 }, to], { duration, easing: SETTLE }).onfinish = () => copy.remove();
}

/** Attach the returned ref to an element that should play its exit when it unmounts. */
export function useExit<T extends HTMLElement>(kind: keyof typeof EXITS): RefObject<T> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (node) leave(node, kind);
    };
  }, [kind]);
  return ref;
}
