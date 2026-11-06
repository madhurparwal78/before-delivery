// The wide horizontal strip of cards (fleet and legs): one card per arrow press or wheel notch, a 360 ms glide,
// and the position hairline.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

const NOTCH_MS = 360;

/** The hairline's place: position ÷ (cards − 1) × 100, half up; 0 with one card. */
function hairlinePosition(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.floor((index * 100 * 2 + (count - 1)) / (2 * (count - 1)));
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !["range", "button", "submit", "checkbox", "radio", "file"].includes(target.type);
  return false;
}

interface StripState {
  index: number;
  setIndex: (index: number) => void;
  viewport: { current: HTMLDivElement | null };
  track: { current: HTMLDivElement | null };
  onWheel: (event: WheelEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onFocusIn: (event: FocusEvent) => void;
}

/** Strip state for `count` cards; `itemSelector` finds the cards inside the track. */
export function useStrip(count: number, enabled: boolean, itemSelector: string): StripState {
  const [index, setRawIndex] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const lastNotch = useRef(-Infinity);
  const clamped = Math.min(index, Math.max(0, count - 1));
  const setIndex = (next: number) => setRawIndex(Math.min(Math.max(0, next), Math.max(0, count - 1)));

  useLayoutEffect(() => {
    const t = track.current;
    const v = viewport.current;
    if (!t || !v) return;
    if (!enabled) {
      t.style.transform = "";
      return;
    }
    const items = t.querySelectorAll<HTMLElement>(itemSelector);
    const target = items[clamped];
    const maxShift = Math.max(0, t.scrollWidth - v.clientWidth);
    const shift = target ? Math.min(target.offsetLeft, maxShift) : 0;
    t.style.transform = shift ? `translateX(${-shift}px)` : "";
  });

  return {
    index: clamped,
    setIndex,
    viewport,
    track,
    onWheel(event) {
      if (!enabled || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.deltaY === 0) return;
      const step = event.deltaY > 0 ? 1 : -1;
      if ((step < 0 && clamped === 0) || (step > 0 && clamped >= count - 1)) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastNotch.current < NOTCH_MS) return;
      lastNotch.current = now;
      setIndex(clamped + step);
    },
    onKeyDown(event) {
      if (!enabled || isTyping(event.target) || (event.target instanceof HTMLInputElement && event.target.type === "range")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex(clamped + (event.key === "ArrowRight" ? 1 : -1));
      }
    },
    onFocusIn(event) {
      const t = track.current;
      if (!enabled || !t) return;
      const items = [...t.querySelectorAll<HTMLElement>(itemSelector)];
      const at = items.findIndex((item) => item.contains(event.target as Node));
      if (at >= 0 && at !== clamped) setIndex(at);
    },
  };
}

export function Hairline({ label, index, count }: { label: string; index: number; count: number }) {
  const value = hairlinePosition(index, count);
  return (
    <div class="hairline" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div class="hairline__fill" style={{ transform: `scaleX(${count <= 1 ? 1 : (index + 1) / count})` }} />
    </div>
  );
}

export function StripFrame({ strip, children, wide }: { strip: StripState; children: ComponentChildren; wide: boolean }) {
  return (
    <div
      class={wide ? "strip" : "stack"}
      ref={strip.viewport}
      onWheel={strip.onWheel}
      onKeyDown={strip.onKeyDown}
      onFocusIn={strip.onFocusIn}
    >
      <div class={wide ? "strip__track" : "stack__track"} ref={strip.track}>
        {children}
      </div>
    </div>
  );
}
