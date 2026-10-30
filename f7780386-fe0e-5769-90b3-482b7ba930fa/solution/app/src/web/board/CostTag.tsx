// The paint cost tag at the band's end: duration and cost split, every changed digit rolling upward.

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { animate, ROLL_MS } from "./motion.js";

interface Props {
  text: string;
  row: number;
  column: number;
  above: boolean;
}

export function CostTag({ text, row, column, above }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(text);
  const [flip, setFlip] = useState(false);
  // Past the visible right edge of the board frame, the tag ends at the band's end instead.
  useLayoutEffect(() => {
    const element = ref.current;
    const frame = element?.closest<HTMLElement>(".board-frame");
    if (!element || !frame) return;
    const style = getComputedStyle(element);
    const unflippedLeft = parseFloat(style.getPropertyValue("--station-w")) + column * parseFloat(style.getPropertyValue("--cell-w")) + 4;
    setFlip(unflippedLeft + element.offsetWidth > frame.scrollLeft + frame.clientWidth);
  });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = text;
    const element = ref.current;
    if (!element || before === text) return;
    const digits = element.querySelectorAll<HTMLElement>(".cost-tag__char");
    digits.forEach((digit, index) => {
      const char = text[index] ?? "";
      if (/\d/.test(char) && before[index] !== char) {
        animate(digit, [{ transform: "translateY(70%)", opacity: 0.15 }, { transform: "translateY(0)", opacity: 1 }], { duration: ROLL_MS });
      }
    });
  }, [text]);
  return (
    <div
      ref={ref}
      class={`cost-tag num${above ? " cost-tag--above" : ""}${flip ? " cost-tag--flip" : ""}`} role="status" aria-label="Paint cost" style={{ "--row": String(row), "--col": String(column) }}>
      {[...text].map((char, index) => (
        <span key={index} class="cost-tag__char">
          {char}
        </span>
      ))}
    </div>
  );
}
