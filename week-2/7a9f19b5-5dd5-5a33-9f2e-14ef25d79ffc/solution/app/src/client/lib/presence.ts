// Panels that enter and leave: the element mounts on open, animates in, and on close becomes inert and hidden from
// assistive tech at once, animates out, then unmounts. Under reduced motion it appears and disappears at once.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./hooks";

const PANEL_IN = { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" };
const PANEL_OUT = { duration: 240, easing: "cubic-bezier(.4,0,1,1)" };
const RISE_IN: Keyframe[] = [
  { opacity: 0, transform: "translateY(12px)" },
  { opacity: 1, transform: "none" },
];
const SINK_OUT: Keyframe[] = [
  { opacity: 1, transform: "none" },
  { opacity: 0, transform: "translateY(8px)" },
];

type Frames = Keyframe[] | ((element: HTMLElement) => Keyframe[]);

interface Motion {
  enter?: Frames;
  exit?: Frames;
  enterTiming?: KeyframeAnimationOptions;
  exitTiming?: KeyframeAnimationOptions;
}

function frames(value: Frames | undefined, fallback: Keyframe[], element: HTMLElement): Keyframe[] {
  return typeof value === "function" ? value(element) : (value ?? fallback);
}

export function usePresence<T extends HTMLElement>(open: boolean, motion: Motion = {}) {
  const ref = useRef<T>(null);
  const firstRender = useRef(true);
  const [present, setPresent] = useState(open);
  // Mount in the same render that opens, so focus can move into the panel straight away.
  if (open && !present) setPresent(true);

  useEffect(() => {
    const element = ref.current;
    if (open || !present) return;
    if (!element || prefersReducedMotion()) {
      setPresent(false);
      return;
    }
    const animation = element.animate(frames(motion.exit, SINK_OUT, element), {
      ...PANEL_OUT,
      ...motion.exitTiming,
      fill: "forwards",
    });
    animation.finished.then(
      () => setPresent(false),
      () => undefined,
    );
    return () => animation.cancel();
    // The motion description is fixed per panel; only opening and closing drive presence.
  }, [open, present]);

  useLayoutEffect(() => {
    const element = ref.current;
    const initial = firstRender.current;
    firstRender.current = false;
    // A panel that starts open (the Photometrics drawer) is simply there on load.
    if (initial || !open || !element || prefersReducedMotion()) return;
    element.animate(frames(motion.enter, RISE_IN, element), { ...PANEL_IN, ...motion.enterTiming });
  }, [open]);

  return { ref, mounted: open || present, closing: !open && present };
}
