import { type ReactNode, type Ref, useLayoutEffect, useRef, useState } from "react";
import { drive, stop } from "../lib/drive";
import { prefersReducedMotion } from "../lib/useMedia";

const DURATION_MS = 300;
const EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";

interface SlideProps {
  open: boolean;
  edge: "right" | "bottom";
  children: (ref: Ref<HTMLElement>) => ReactNode;
}

export function Slide({ open, edge, children }: SlideProps) {
  const [present, setPresent] = useState(open);
  const element = useRef<HTMLElement | null>(null);
  const animation = useRef<Animation | null>(null);
  if (open && !present) setPresent(true);

  useLayoutEffect(() => {
    const el = element.current;
    const running = animation.current;
    if (!el) return;
    const settle = (direction: 1 | -1) => {
      if (direction < 0) {
        animation.current = null;
        setPresent(false);
      }
    };
    if (open) {
      if (prefersReducedMotion()) return;
      if (running) {
        running.playbackRate = 1;
        drive(running, settle);
        return;
      }
      const hidden = edge === "right" ? "translateX(100%)" : "translateY(100%)";
      const slide = el.animate([{ transform: hidden }, { transform: "none" }], { duration: DURATION_MS, easing: EASING, fill: "both" });
      animation.current = slide;
      drive(slide, settle);
      return;
    }
    if (!running || prefersReducedMotion()) {
      if (running) stop(running);
      animation.current = null;
      setPresent(false);
      return;
    }
    running.playbackRate = -1;
    drive(running, settle);
  }, [open, present, edge]);

  if (!present) return null;
  return <>{children((node) => void (element.current = node))}</>;
}
