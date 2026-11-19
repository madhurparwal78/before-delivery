// Menus that always open fully inside the viewport, flip above or left of the anchor when needed,
// and keep clear of the bottom toolbar, page strip and view controls (brief: Menu placement).
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useOutside, useTrap } from "../dialog";

export interface MenuItem {
  label: string;
  disabled?: boolean;
  run: () => void;
}

const GAP = 4;
const BLOCKERS = ["#bottom-toolbar", "#page-strip", "#view-controls"];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The first candidate position that fits the viewport and avoids every blocker. */
function placeMenu(anchor: Rect, size: { w: number; h: number }): { x: number; y: number } {
  const vw = innerWidth;
  const vh = innerHeight;
  const blockers = BLOCKERS.map((sel) => document.querySelector(sel)?.getBoundingClientRect())
    .filter((r): r is DOMRect => !!r && r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  const clamp = (x: number, y: number) => ({ x: Math.min(Math.max(GAP, x), vw - size.w - GAP), y: Math.min(Math.max(GAP, y), vh - size.h - GAP) });
  const below = anchor.y + anchor.h + GAP;
  const above = anchor.y - size.h - GAP;
  const right = anchor.x;
  const left = anchor.x + anchor.w - size.w;
  const candidates = [
    clamp(right, below), clamp(left, below), clamp(right, above), clamp(left, above),
    clamp(anchor.x - size.w - GAP, anchor.y), clamp(anchor.x + anchor.w + GAP, anchor.y),
  ];
  const fits = (p: { x: number; y: number }) => !blockers.some((b) => overlaps({ ...p, ...size }, b));
  const found = candidates.find(fits);
  if (found) return found;
  const top = Math.min(...blockers.map((b) => b.y), vh);
  return clamp(right, top - size.h - GAP);
}

export function Menu({ label, anchor, items, onClose, returnTo }: {
  label: string;
  anchor: Rect;
  items: MenuItem[];
  onClose: () => void;
  returnTo: HTMLElement | SVGElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useTrap(ref, onClose, returnTo, '[role="menuitem"]:not([disabled])');
  useOutside(ref, onClose);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setPos(placeMenu(anchor, { w: el.offsetWidth, h: el.offsetHeight }));
  }, []);
  const move = (e: KeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const index = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") go(index + 1);
    else if (e.key === "ArrowUp") go(index - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div ref={ref} role="menu" aria-label={label} class="menu" onKeyDown={move}
      style={{ left: `${pos?.x ?? -9999}px`, top: `${pos?.y ?? -9999}px` }}>
      {items.map((item) => (
        <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
          onClick={() => {
            onClose();
            item.run();
          }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
