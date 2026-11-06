import Lenis from "lenis";

import type { Disposables } from "./Disposables";
import type { Quality } from "./webgl/quality";

/** A `--vh` unit that ignores mobile toolbars, and a fresh visit always starting at the top. */
export function initViewport(disposables: Disposables) {
  const root = document.documentElement;
  const setVh = () => root.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);
  setVh();
  disposables.listen(window, "resize", setVh);
  if (!window.location.hash) {
    window.history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
  }
}

/** Smooth wheel scrolling on desktop with a fine pointer; native scrolling on touch and under reduced motion. */
export function initSmoothScroll(disposables: Disposables, quality: Quality): Lenis | null {
  const desktop = window.innerWidth >= 1025 && window.matchMedia("(pointer: fine)").matches;
  if (quality.reduced || !desktop) return null;
  const lenis = new Lenis({ lerp: 0.2, wheelMultiplier: 0.9, autoRaf: false });
  disposables.add(() => lenis.destroy());
  return lenis;
}
