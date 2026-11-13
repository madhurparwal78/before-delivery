import { useLayoutEffect, useRef, type ReactNode } from "react";
import { rupees } from "../../shared/format";
import { useReducedMotion } from "../lib/hooks";

const COLUMN_MS = 300;
const STAGGER_MS = 40;
const LINE_HEIGHT_EM = 1.1;

interface ReelProps {
  paise: number;
  /** The accessible name of the group, such as "Payable total". */
  label: string;
  className?: string;
}

function stripPosition(strip: HTMLElement): number {
  const transform = getComputedStyle(strip).transform;
  if (transform === "none") return Number(strip.style.getPropertyValue("--digit") || 0);
  const ty = Number(transform.slice(transform.indexOf("(") + 1, -1).split(",")[5] ?? 0);
  return -ty / (parseFloat(getComputedStyle(strip).fontSize) * LINE_HEIGHT_EM);
}

/**
 * The Rupee Reel: the group's text is always the server's amount; the digit columns are drawn from CSS
 * and spin to the new digit over 300 ms, the rightmost column first and each column to its left 40 ms later.
 * A newer amount retargets from wherever the columns are.
 */
export function Reel({ paise, label, className }: ReelProps): ReactNode {
  const text = rupees(paise);
  const reduced = useReducedMotion();
  const host = useRef<HTMLSpanElement>(null);
  const targets = useRef(new Map<HTMLElement, Animation>());
  const characters = [...text];

  useLayoutEffect(() => {
    const strips = [...(host.current?.querySelectorAll<HTMLElement>(".reel__strip") ?? [])];
    strips.reverse().forEach((strip, order) => {
      const digit = Number(strip.dataset.digit);
      const from = strip.dataset.seen === undefined ? 0 : Number(strip.dataset.seen);
      const running = targets.current.get(strip);
      const start = running ? stripPosition(strip) : from;
      running?.cancel();
      strip.dataset.seen = String(digit);
      if (reduced || start === digit) {
        strip.style.setProperty("--digit", String(digit));
        return;
      }
      strip.style.setProperty("--digit", String(start));
      const animation = strip.animate(
        [{ transform: `translateY(${-start * LINE_HEIGHT_EM}em)` }, { transform: `translateY(${-digit * LINE_HEIGHT_EM}em)` }],
        { duration: COLUMN_MS, delay: order * STAGGER_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" },
      );
      targets.current.set(strip, animation);
      animation.onfinish = () => {
        strip.style.setProperty("--digit", String(digit));
        animation.cancel();
        targets.current.delete(strip);
      };
    });
  }, [text, reduced]);

  return (
    <div role="group" aria-label={label} className={className} style={{ display: "inline-block" }}>
      <span className="sr-only">{text}</span>
      <span className="reel" aria-hidden="true" ref={host}>
        {characters.map((char, index) => {
          const fromRight = characters.length - 1 - index;
          return /\d/.test(char) ? (
            <span className="reel__col" key={`d${fromRight}`}>
              <span className="reel__strip" data-digit={char} />
            </span>
          ) : (
            <span className="reel__fixed" data-char={char} key={`f${fromRight}${char}`} />
          );
        })}
      </span>
    </div>
  );
}
