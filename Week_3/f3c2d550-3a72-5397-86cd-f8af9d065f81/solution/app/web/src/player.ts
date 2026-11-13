import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stopAnnouncement, type Identity } from "../../shared/words";
import { isTextEntry } from "./hooks";
import { prefersReducedMotion } from "./motion";
import { useField, type Subject } from "./field";

export interface PlayerStop {
  key: string;
  subject: Subject;
  identity: Identity;
}

const SCROLL_MS = 260;

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * One fader over an ordered list of playable stops: value, address, scroll, swap and announcement
 * for every user-driven change, and the scroll binding in both directions.
 */
export function useStopPlayer(stops: PlayerStop[], getRows: () => HTMLElement[], onChange?: (index: number) => void) {
  const field = useField();
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const rowsRef = useRef(getRows);
  rowsRef.current = getRows;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const suppressScroll = useRef(false);
  const scrollFrame = useRef(0);

  const announcementAt = useCallback((at: number): string => {
    const list = stopsRef.current;
    const stop = list[at];
    return stop ? stopAnnouncement(at + 1, list.length, stop.identity) : "";
  }, []);

  const scrollRowToMiddle = useCallback((at: number, instant: boolean) => {
    const row = rowsRef.current()[at];
    if (!row) return;
    window.cancelAnimationFrame(scrollFrame.current);
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    const target = Math.min(Math.max(0, row.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2), maximum);
    const start = window.scrollY;
    if (Math.abs(target - start) < 1) return;
    suppressScroll.current = true;
    if (instant || prefersReducedMotion()) {
      window.scrollTo({ top: target, behavior: "instant" });
      return;
    }
    const began = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - began) / SCROLL_MS);
      window.scrollTo({ top: start + (target - start) * easeOut(progress), behavior: "instant" });
      if (progress < 1) scrollFrame.current = window.requestAnimationFrame(frame);
    };
    scrollFrame.current = window.requestAnimationFrame(frame);
  }, []);

  /** Moves the fader without a swap or an announcement (first load, refetch that keeps the reference). */
  const place = useCallback(
    (at: number, scroll: boolean) => {
      const stop = stopsRef.current[at];
      if (!stop) return;
      indexRef.current = at;
      setIndex(at);
      changeRef.current?.(at);
      field.show(stop.subject);
      if (scroll) scrollRowToMiddle(at, true);
    },
    [field, scrollRowToMiddle],
  );

  const select = useCallback(
    (at: number, scroll = true, forced?: 1 | -1) => {
      const list = stopsRef.current;
      const stop = list[at];
      if (!stop || (at === indexRef.current && !forced)) return;
      const direction = forced ?? (at > indexRef.current ? 1 : -1);
      indexRef.current = at;
      setIndex(at);
      changeRef.current?.(at);
      if (scroll) scrollRowToMiddle(at, false);
      field.swapTo(stop.subject, direction);
      field.announce(announcementAt(at));
    },
    [announcementAt, field, scrollRowToMiddle],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      const next = Math.min(stopsRef.current.length - 1, Math.max(0, indexRef.current + delta));
      select(next);
    },
    [select],
  );

  const count = stops.length;
  const valueText = announcementAt(index);

  useEffect(() => {
    if (count === 0) {
      field.setFader(null);
      return;
    }
    field.setFader({ count, value: Math.min(index, count - 1), valueText, select, step });
  }, [count, index, valueText, field, select, step]);

  useEffect(() => () => {
    field.setFader(null);
    field.announce("");
    window.cancelAnimationFrame(scrollFrame.current);
  }, [field]);

  useEffect(() => {
    const currentFromScroll = () => {
      const rows = rowsRef.current();
      const middle = window.innerHeight / 2 + 1;
      let found = 0;
      rows.forEach((row, at) => {
        if (row.getBoundingClientRect().top <= middle) found = at;
      });
      return found;
    };
    const onScroll = () => {
      if (suppressScroll.current) return;
      select(currentFromScroll(), false);
    };
    const onUserInput = () => {
      suppressScroll.current = false;
      window.cancelAnimationFrame(scrollFrame.current);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== "]" && event.key !== "[")) return;
      if (isTextEntry(event.target) || document.querySelector("dialog[open]")) return;
      step(event.key === "]" ? 1 : -1);
    };
    const userEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    window.addEventListener("scroll", onScroll, { passive: true });
    userEvents.forEach((name) => window.addEventListener(name, onUserInput, { capture: true, passive: true }));
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll);
      userEvents.forEach((name) => window.removeEventListener(name, onUserInput, { capture: true }));
      document.removeEventListener("keydown", onKey);
    };
  }, [select, step]);

  return useMemo(
    () => ({ index, indexRef, select, step, place, announcementAt }),
    [index, select, step, place, announcementAt],
  );
}
