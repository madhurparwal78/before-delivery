import { useLayoutEffect, useRef } from "preact/hooks";

// The gameweek total. On a relay it counts from the old value to the new one, each digit rolling
// separately like a scoreboard drum (brief: Points relay stage 3).
export function RollingNumber({ value, roll }: { value: number; roll: number }) {
  const previous = useRef(value);
  const lastRoll = useRef(roll);
  const host = useRef<HTMLSpanElement>(null);
  const from = previous.current;
  const rolling = roll !== lastRoll.current && from !== value;
  const width = Math.max(String(from).length, String(value).length);
  const oldText = String(from).padStart(width, " ");
  const newText = String(value).padStart(width, " ");

  useLayoutEffect(() => {
    previous.current = value;
    lastRoll.current = roll;
    if (!rolling || !host.current) return;
    for (const column of host.current.querySelectorAll<HTMLElement>(".roll-col")) {
      const steps = Number(column.dataset.steps);
      if (steps > 0) {
        column.animate([{ transform: "translateY(0)" }, { transform: `translateY(-${steps}em)` }], {
          duration: 600,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "forwards",
        });
      }
    }
  });

  if (!rolling) return <span>{value}</span>;
  return (
    <span ref={host} class="roll">
      <span class="sr-only">{value}</span>
      {[...newText].map((digit, index) => {
        const start = oldText[index]!;
        const sequence = start === digit ? [digit] : drum(start, digit);
        return (
          <span class="roll-col" data-steps={sequence.length - 1} key={index} aria-hidden="true">
            {sequence.map((glyph, i) => (
              <span key={i}>{glyph === " " ? " " : glyph}</span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

function drum(start: string, end: string): string[] {
  if (!/\d/.test(start) || !/\d/.test(end)) return [start, end];
  const out: string[] = [];
  let digit = Number(start);
  out.push(String(digit));
  while (String(digit) !== end) {
    digit = (digit + 1) % 10;
    out.push(String(digit));
  }
  return out;
}
