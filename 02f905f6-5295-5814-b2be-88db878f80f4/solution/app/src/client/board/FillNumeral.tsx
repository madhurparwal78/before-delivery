// The `Load <fill>% full` numeral: counts through whole percents to a new value in 0.6 s.
import { useEffect, useRef, useState } from "react";
import { DURATION, linear, tween } from "../motion";

export function FillNumeral({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const stop = tween(
      DURATION.fill,
      (p) => {
        const current = Math.round(start + (value - start) * p);
        from.current = current;
        setShown(current);
      },
      undefined,
      linear,
    );
    return stop;
  }, [value]);
  return (
    <div className="fill" role="meter" aria-label="Load fill" aria-valuemin={0} aria-valuemax={Math.max(100, value)} aria-valuenow={value} aria-valuetext={`Load ${value}% full`}>
      <span className="fill-text">
        Load <span className="num-strong">{shown}%</span> full
      </span>
      <span className="fill-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(shown, 100)}%` }} />
      </span>
    </div>
  );
}
