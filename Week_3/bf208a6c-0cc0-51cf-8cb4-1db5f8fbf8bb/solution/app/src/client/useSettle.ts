import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { DURATION, reducedMotion, tween } from "./motion";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function measure(root: HTMLElement): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const frame of root.querySelectorAll<HTMLElement>("[data-post-id]")) {
    boxes.set(frame.dataset["postId"] ?? "", { x: frame.offsetLeft, y: frame.offsetTop, width: frame.offsetWidth, height: frame.offsetHeight });
  }
  return boxes;
}

const lerp = (from: number, to: number, progress: number): number => from + (to - from) * progress;

/**
 * After every render, frames that changed place glide from where they were (FLIP) and new frames settle in.
 * A frame whose loupe opened or closed takes its new size at once in the layout and grows or shrinks to it from the
 * old size (a closing frame shrinks about its centre, so its middle stays on its slot), while its neighbours glide
 * to their new places.
 */
export function useSettle(root: RefObject<HTMLElement | null>, loupeId: string | null, draggingId: string | null, release: RefObject<{ id: string; x: number; y: number } | null>): void {
  const previous = useRef(new Map<string, Box>());
  const previousLoupe = useRef<string | null>(null);

  useEffect(() => {
    const remeasure = (): void => {
      if (root.current) previous.current = measure(root.current);
    };
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, [root]);

  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const boxes = measure(container);
    const before = previous.current;
    const toggled = new Set([previousLoupe.current, loupeId].filter((id): id is string => id !== null && previousLoupe.current !== loupeId));
    previous.current = boxes;
    previousLoupe.current = loupeId;
    if (reducedMotion() || before.size === 0) return;
    for (const frame of container.querySelectorAll<HTMLElement>("[data-post-id]")) {
      const id = frame.dataset["postId"] ?? "";
      const from = before.get(id);
      const to = boxes.get(id);
      if (!to) continue;
      const reset = (): void => {
        frame.style.transform = "";
        frame.style.transformOrigin = "";
        frame.style.opacity = "";
      };
      if (toggled.has(id)) {
        if (!from) continue;
        frame.style.transformOrigin = loupeId === id ? "top left" : "center";
        tween(frame, DURATION.loupe, (p) => (frame.style.transform = `scale(${lerp(from.width / to.width, 1, p)}, ${lerp(from.height / to.height, 1, p)})`), reset);
      } else if (!from) {
        tween(frame, DURATION.settle, (p) => {
          frame.style.opacity = String(p);
          frame.style.transform = `translateY(${lerp(8, 0, p)}px)`;
        }, reset);
      } else if (id !== draggingId) {
        const shift = release.current?.id === id ? release.current : null;
        if (shift) release.current = null;
        const dx = from.x + (shift?.x ?? 0) - to.x;
        const dy = from.y + (shift?.y ?? 0) - to.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) tween(frame, DURATION.settle, (p) => (frame.style.transform = `translate(${lerp(dx, 0, p)}px, ${lerp(dy, 0, p)}px)`), reset);
      }
    }
  });
}
