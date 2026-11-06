// A countdown whose changed digits roll (brief: Wait states; Motion → 140 ms feedback). Only the digit spans
// animate; the timer element itself never does.
import { useEffect, useRef, useState } from "react";
import { countdown } from "../shared/format";
import { serverNow } from "./api";

/** The server's time, read afresh on every render; the ticking state re-renders once a second. */
export function useNow(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return serverNow();
}

/** Each character in its own span; a digit whose value changed rolls in from below as its old value rolls up out. */
function RollingDigits({ text }: { text: string }): JSX.Element {
  const previous = useRef<string | null>(null);
  const before = previous.current;
  useEffect(() => {
    previous.current = text;
  }, [text]);
  return (
    <span className="rolling-digits" aria-hidden="true">
      {text.split(" ").map((word, w, words) => {
        const offset = words.slice(0, w).join(" ").length + (w ? 1 : 0);
        return (
          <span key={w} className="digit-word">
            {[...word].map((ch, k) => {
              const i = offset + k;
              const rolled = before !== null && /\d/.test(ch) && before[i] !== undefined && before[i] !== ch;
              return (
                <span
                  key={`${i}-${ch}`}
                  className={/\d/.test(ch) ? (rolled ? "digit is-rolling" : "digit") : "digit-sep"}
                  data-old={rolled ? before[i] : undefined}
                >
                  {ch}
                </span>
              );
            })}
          </span>
        );
      })}
    </span>
  );
}

export function Countdown({ label, targetMs, now, className }: { label: string; targetMs: number | null; now: number; className?: string }): JSX.Element {
  const text = countdown(targetMs === null ? 0 : targetMs - now);
  return (
    <div role="timer" aria-label={label} className={`countdown mono${className ? ` ${className}` : ""}`}>
      <RollingDigits text={text} />
      <span className="sr-only">{text}</span>
    </div>
  );
}
