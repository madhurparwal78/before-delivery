// Scroll-tied motion: every value is set from the scroll position alone, so scrolling back retraces it exactly.
// Section heads widen as they travel up the viewport, the nav takes the pair of the ground filling the view,
// the pinned story steps through its statements, and the gallery pans its frames sideways while pinned.
import { useEffect } from "react";
import { usePrefersReducedMotion } from "./useReducedMotion.ts";

const CONDENSED = 75;
const WIDE = 125;

const clamp = (v: number) => Math.min(Math.max(v, 0), 1);

function update(reduced: boolean): void {
  const vh = window.innerHeight;
  const vw = document.documentElement.clientWidth;

  let ground: string | null = null;
  for (const section of document.querySelectorAll<HTMLElement>("[data-ground]")) {
    const r = section.getBoundingClientRect();
    if (Math.min(r.bottom, vh) - Math.max(r.top, 0) > vh / 2) ground = section.dataset.ground ?? null;
  }
  if (ground && document.documentElement.dataset.ground !== ground) document.documentElement.dataset.ground = ground;

  if (reduced) return;

  // Heads widen from condensed at the bottom of the viewport to wide at its upper third.
  const stretchAt = (top: number) => `${(CONDENSED + (WIDE - CONDENSED) * clamp((vh - top) / (vh - vh / 3))).toFixed(2)}%`;
  for (const head of document.querySelectorAll<HTMLElement>("[data-kinetic]")) head.style.fontStretch = stretchAt(head.getBoundingClientRect().top);
  for (const day of document.querySelectorAll<HTMLElement>("[data-day-head]")) day.style.setProperty("--stretch", stretchAt(day.getBoundingClientRect().top));

  for (const story of document.querySelectorAll<HTMLElement>("[data-story]")) {
    const r = story.getBoundingClientRect();
    const p = clamp(-r.top / Math.max(1, r.height - vh));
    const step = String(Math.min(2, Math.floor(p * 3)));
    if (story.dataset.step !== step) story.dataset.step = step;
  }

  for (const gallery of document.querySelectorAll<HTMLElement>("[data-gallery]")) {
    const track = gallery.querySelector<HTMLElement>("[data-gallery-track]");
    if (!track) continue;
    const distance = Math.max(0, track.scrollWidth - vw);
    const wanted = `${vh + distance}px`;
    if (gallery.style.height !== wanted) gallery.style.height = wanted;
    const r = gallery.getBoundingClientRect();
    const p = clamp(-r.top / Math.max(1, distance));
    track.style.transform = `translate3d(${(-p * distance).toFixed(1)}px, 0, 0)`;
    for (const frame of track.querySelectorAll<HTMLElement>("[data-frame]")) {
      const f = frame.getBoundingClientRect();
      frame.style.setProperty("--open", clamp((vw - f.left) / (f.width * 0.9)).toFixed(3));
    }
  }
}

export function useScrollMotion(ready: boolean): void {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
    for (const gallery of document.querySelectorAll<HTMLElement>("[data-gallery]")) if (reduced) gallery.style.height = "";
    if (reduced) {
      for (const head of document.querySelectorAll<HTMLElement>("[data-kinetic]")) head.style.fontStretch = "";
      for (const day of document.querySelectorAll<HTMLElement>("[data-day-head]")) day.style.removeProperty("--stretch");
    }
    const run = () => update(reduced);
    run();
    // Scroll events can arrive a frame after the scroll itself; each animation frame also re-reads the position,
    // so the scroll-tied values always match where the page is. Nothing is drawn when nothing moved.
    let last = "";
    let frame = requestAnimationFrame(function sync() {
      const now = `${window.scrollX},${window.scrollY},${window.innerWidth},${window.innerHeight}`;
      if (now !== last) { last = now; run(); }
      frame = requestAnimationFrame(sync);
    });
    window.addEventListener("scroll", run, { passive: true });
    window.addEventListener("resize", run);
    const rules = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-drawn");
          rules.unobserve(entry.target);
        }
      }
    }, { threshold: 0.2 });
    for (const table of document.querySelectorAll("[data-rules]")) rules.observe(table);
    return () => {
      window.removeEventListener("scroll", run);
      window.removeEventListener("resize", run);
      cancelAnimationFrame(frame);
      rules.disconnect();
    };
  }, [reduced, ready]);
}
