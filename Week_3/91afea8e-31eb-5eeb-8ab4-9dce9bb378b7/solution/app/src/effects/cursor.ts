/**
 * Magnetic cursor. It only exists for a real mouse (detected from pointermove events whose pointerType is "mouse"),
 * never in text fields, during keyboard use, on touch devices or under reduced motion.
 * - useCustomCursor: a cursor that grows over product cards, reads "drag" over the 3D viewer and leaves a fading trail.
 * - useMagnet: pulls a button toward the cursor by at most 8 px when the cursor is within 60 px.
 */
import { useEffect, type RefObject } from "react";

const MAGNET_RANGE = 60;
const MAGNET_MAX = 8;
const TRAIL_FADE_MS = 400;
const TRAIL_DOTS = 10;
const TRAIL_SPACING = 10;

interface Pointer {
  x: number;
  y: number;
  target: Element | null;
  /** A real mouse is in use, the keyboard is not, and the visitor accepts motion. */
  live: boolean;
}

const pointer: Pointer = { x: -1000, y: -1000, target: null, live: false };
const listeners = new Set<() => void>();
let installed = 0;
let keyboard = false;
let mouse = false;

const reducedQuery = (): MediaQueryList => window.matchMedia("(prefers-reduced-motion: reduce)");

function overTextField(target: Element | null): boolean {
  return target instanceof HTMLElement && target.closest("input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]") !== null;
}

function refresh(): void {
  pointer.live = mouse && !keyboard && !reducedQuery().matches;
  for (const listener of listeners) listener();
}

function onMove(event: PointerEvent): void {
  if (event.pointerType !== "mouse") {
    mouse = false;
    refresh();
    return;
  }
  mouse = true;
  keyboard = false;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.target = event.target instanceof Element ? event.target : null;
  refresh();
}

function onTouch(event: PointerEvent): void {
  if (event.pointerType === "mouse") return;
  mouse = false;
  refresh();
}

function onKey(): void {
  keyboard = true;
  refresh();
}

function onLeave(event: MouseEvent): void {
  if (event.relatedTarget === null) {
    pointer.x = -1000;
    pointer.y = -1000;
    pointer.target = null;
    refresh();
  }
}

function subscribe(listener: () => void): () => void {
  if (installed === 0) {
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onTouch, { passive: true });
    window.addEventListener("keydown", onKey);
    document.documentElement.addEventListener("mouseleave", onLeave);
    reducedQuery().addEventListener("change", refresh);
  }
  installed += 1;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    installed -= 1;
    if (installed === 0) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onTouch);
      window.removeEventListener("keydown", onKey);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      reducedQuery().removeEventListener("change", refresh);
    }
  };
}

/** The custom cursor and its trail. Mount once per page that has product cards or the viewer. */
export function useCustomCursor(): void {
  useEffect(() => {
    const cursor = document.createElement("div");
    cursor.className = "fx-cursor";
    cursor.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "fx-cursor__label";
    cursor.appendChild(label);
    const dots: HTMLElement[] = [];
    for (let index = 0; index < TRAIL_DOTS; index += 1) {
      const dot = document.createElement("div");
      dot.className = "fx-trail";
      dot.setAttribute("aria-hidden", "true");
      dots.push(dot);
    }
    document.body.append(cursor, ...dots);
    const born: number[] = dots.map(() => -Infinity);
    let fade = 0;
    let next = 0;
    let lastX = -1000;
    let lastY = -1000;
    const root = document.documentElement;

    /** The trail fades over 400 ms of frame time, so it is gone whenever the page clock has moved on. */
    const settle = (now: number): void => {
      let alive = false;
      dots.forEach((dot, index) => {
        const age = now - (born[index] as number);
        if (age >= TRAIL_FADE_MS) {
          dot.style.opacity = "0";
          return;
        }
        dot.style.opacity = String(0.55 * (1 - age / TRAIL_FADE_MS));
        alive = true;
      });
      fade = alive ? requestAnimationFrame(settle) : 0;
    };

    const update = (): void => {
      const visible = pointer.live && !overTextField(pointer.target) && pointer.x >= 0;
      root.classList.toggle("fx-cursor-on", visible);
      cursor.classList.toggle("is-visible", visible);
      if (!visible) return;
      const target = pointer.target;
      const drag = target?.closest("[data-cursor=drag]") != null;
      cursor.classList.toggle("is-card", target?.closest("[data-cursor=card]") != null);
      cursor.classList.toggle("is-drag", drag);
      label.textContent = drag ? "drag" : "";
      cursor.style.translate = `${pointer.x}px ${pointer.y}px`;
      if (Math.hypot(pointer.x - lastX, pointer.y - lastY) >= TRAIL_SPACING) {
        const dot = dots[next] as HTMLElement;
        next = (next + 1) % TRAIL_DOTS;
        dot.style.translate = `${pointer.x}px ${pointer.y}px`;
        dot.style.opacity = "0.55";
        born[next === 0 ? TRAIL_DOTS - 1 : next - 1] = performance.now();
        if (fade === 0) fade = requestAnimationFrame(settle);
        lastX = pointer.x;
        lastY = pointer.y;
      }
    };

    const unsubscribe = subscribe(update);
    update();
    return () => {
      unsubscribe();
      cancelAnimationFrame(fade);
      root.classList.remove("fx-cursor-on");
      cursor.remove();
      dots.forEach((dot) => dot.remove());
    };
  }, []);
}

/** Pulls the first button inside `container` toward the cursor: at most 8 px, only within 60 px of it. */
export function useMagnet(container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = container.current;
    const button = host?.querySelector<HTMLElement>("button");
    if (!button) return undefined;
    const now = { x: 0, y: 0 };
    const goal = { x: 0, y: 0 };
    let frame = 0;

    const step = (): void => {
      now.x += (goal.x - now.x) * 0.3;
      now.y += (goal.y - now.y) * 0.3;
      if (Math.abs(goal.x - now.x) < 0.05 && Math.abs(goal.y - now.y) < 0.05) {
        now.x = goal.x;
        now.y = goal.y;
        button.style.translate = now.x === 0 && now.y === 0 ? "" : `${now.x}px ${now.y}px`;
        frame = 0;
        return;
      }
      button.style.translate = `${now.x}px ${now.y}px`;
      frame = requestAnimationFrame(step);
    };

    const aim = (): void => {
      goal.x = 0;
      goal.y = 0;
      if (pointer.live && pointer.x >= 0) {
        const box = button.getBoundingClientRect();
        const left = box.left - now.x;
        const top = box.top - now.y;
        const cx = left + box.width / 2;
        const cy = top + box.height / 2;
        const gapX = Math.max(left - pointer.x, 0, pointer.x - (left + box.width));
        const gapY = Math.max(top - pointer.y, 0, pointer.y - (top + box.height));
        const gap = Math.hypot(gapX, gapY);
        const away = Math.hypot(pointer.x - cx, pointer.y - cy);
        if (gap < MAGNET_RANGE && away > 4) {
          const force = MAGNET_MAX * (1 - gap / MAGNET_RANGE) * Math.min(1, (away - 4) / 20);
          goal.x = ((pointer.x - cx) / away) * force;
          goal.y = ((pointer.y - cy) / away) * force;
        }
      }
      if (frame === 0) frame = requestAnimationFrame(step);
    };

    const unsubscribe = subscribe(aim);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      button.style.translate = "";
    };
  }, [container]);
}
