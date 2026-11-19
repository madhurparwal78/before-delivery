import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";

/** Counts up or down to the server's figure over just under a second; one step under reduced motion. */
export function Count({ value }: { value: number }) {
  const { reduced } = useStore();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || from.current === value) { from.current = value; setShown(value); return; }
    const start = from.current;
    let frame = 0;
    let begin = -1;
    const step = (now: number) => {
      if (begin < 0) begin = now;
      const t = Math.min(1, (now - begin) / 900);
      const eased = 1 - (1 - t) * (1 - t);
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    const settle = window.setTimeout(() => { setShown(value); }, 950);
    from.current = value;
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); };
  }, [value, reduced]);
  return <span className="fig">{shown}</span>;
}
