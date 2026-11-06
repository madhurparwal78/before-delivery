import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type Viewport = "phone" | "tablet" | "desktop";

const PHONE = window.matchMedia("(max-width: 639px)");
const DESKTOP = window.matchMedia("(min-width: 1024px)");
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

export const prefersReducedMotion = (): boolean => REDUCED.matches;

const currentViewport = (): Viewport => (PHONE.matches ? "phone" : DESKTOP.matches ? "desktop" : "tablet");

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState(currentViewport);
  useEffect(() => {
    const update = (): void => setViewport(currentViewport());
    PHONE.addEventListener("change", update);
    DESKTOP.addEventListener("change", update);
    return () => {
      PHONE.removeEventListener("change", update);
      DESKTOP.removeEventListener("change", update);
    };
  }, []);
  return viewport;
}

/** Ref for a drag grip: `touch-action` alone leaves the browser reading a drag as a fling, which swallows the next tap. */
export function holdGripTouches(grip: HTMLElement | null): void {
  grip?.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
}

const EXIT_MS = 120;

/** Keeps a panel mounted through a short exit; reopening during the exit keeps it open. */
export function usePresence<T extends HTMLElement>(open: boolean, exit: Keyframe[]): { mounted: boolean; ref: RefObject<T | null> } {
  const [mounted, setMounted] = useState(open);
  const ref = useRef<T>(null);
  const exiting = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    if (open) {
      exiting.current?.cancel();
      exiting.current = null;
      setMounted(true);
      return;
    }
    const element = ref.current;
    if (!element || prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const animation = element.animate(exit, { duration: EXIT_MS, easing: "ease-in", fill: "forwards" });
    exiting.current = animation;
    animation.finished.then(() => setMounted(false), () => undefined);
  }, [open]);
  return { mounted, ref };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);

let modals = 0;

const setShellInert = (inert: boolean): void => {
  const shell = document.getElementById("shell");
  if (shell) shell.inert = inert;
};

/** Focus for a dialog or sheet: in on open, wrapped by Tab, Escape closes, back to the opener after. */
export function useModal<T extends HTMLElement>(ref: RefObject<T | null>, onClose: () => void, active = true): void {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modals += 1;
    setShellInert(true);
    (root.querySelector<HTMLElement>("[data-first-focus]") ?? focusables(root)[0] ?? root).focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab") {
        const stops = focusables(root);
        const first = stops[0];
        const last = stops.at(-1);
        const here = document.activeElement;
        if (!first || !last) event.preventDefault();
        else if (event.shiftKey && (here === first || here === root)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && here === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      modals -= 1;
      if (modals === 0) setShellInert(false);
      if (opener?.isConnected) opener.focus();
    };
  }, [active]);
}
