import { useEffect, useRef, useState } from "react";

export function useLayoutWidth(): "phone" | "tablet" | "desktop" {
  const compute = (): "phone" | "tablet" | "desktop" => {
    const width = window.innerWidth;
    if (width < 600) return "phone";
    if (width < 1024) return "tablet";
    return "desktop";
  };
  const [layout, setLayout] = useState<"phone" | "tablet" | "desktop">(compute);
  useEffect(() => {
    const listener = () => setLayout(compute());
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, []);
  return layout;
}

/** A notice that clears after a fixed time, never overwriting a newer one. */
export function useNotice(seconds: number): {
  text: string;
  show: (value: string) => void;
  clear: () => void;
} {
  const [text, setText] = useState("");
  const counter = useRef(0);
  const timer = useRef<number | null>(null);
  const show = (value: string) => {
    counter.current += 1;
    const mine = counter.current;
    setText(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (counter.current === mine) setText("");
    }, seconds * 1000);
  };
  const clear = () => {
    counter.current += 1;
    setText("");
    if (timer.current !== null) window.clearTimeout(timer.current);
  };
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return { text, show, clear };
}

/** A notice that stays until the next replaces it. */
export function useSticky(): { text: string; set: (value: string) => void } {
  const [text, setText] = useState("");
  return { text, set: setText };
}

export function focusSafe(element: HTMLElement | null): void {
  element?.focus();
}
