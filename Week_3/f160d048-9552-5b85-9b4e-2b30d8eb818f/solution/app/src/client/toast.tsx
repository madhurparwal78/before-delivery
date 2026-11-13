import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { announce } from "./announce";
import { settings } from "./settings";
import { EASE, motionMs } from "./motion";

type ToastMessage = { id: number; text: string };
let current: ToastMessage | null = null;
const listeners = new Set<() => void>();

/** A toast with the same text is announced too. */
export function showToast(text: string): void {
  current = { id: (current?.id ?? 0) + 1, text };
  listeners.forEach((listener) => listener());
  announce(text);
}

type ToastState = "opening" | "open" | "closing" | "closed";

export function ToastHost() {
  const message = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  const [state, setState] = useState<ToastState>("closed");
  const element = useRef<HTMLDivElement>(null);
  const ms = motionMs(200);
  useEffect(() => {
    if (!message) return;
    const timers: number[] = [];
    const animate = (keyframes: Keyframe[]) => {
      if (ms > 0) element.current?.animate(keyframes, { duration: ms, easing: EASE, fill: "both" });
    };
    setState(ms === 0 ? "open" : "opening");
    animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }]);
    if (ms > 0) timers.push(window.setTimeout(() => setState("open"), ms));
    timers.push(
      window.setTimeout(() => {
        setState(ms === 0 ? "closed" : "closing");
        animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(8px)" }]);
        if (ms > 0) timers.push(window.setTimeout(() => setState("closed"), ms));
      }, settings.toastSeconds * 1000),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [message, ms]);
  if (!message) return null;
  return (
    <div className="toast-host">
      <div ref={element} className="toast" data-motion="toast" data-motion-ms={ms} data-state={state} aria-hidden="true">
        {message.text}
      </div>
    </div>
  );
}
