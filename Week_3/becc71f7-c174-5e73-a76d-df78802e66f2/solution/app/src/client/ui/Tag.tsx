// The hanging price tag. The current price and the struck price are the server's; a change of price while it is open swings the tag once.
import { useLayoutEffect, useRef } from "react";
import { formatMoney } from "../../shared/format";
import { reducedMotion } from "../state";

const SWING: Keyframe[] = [
  { transform: "rotate(0deg)" },
  { transform: "rotate(6deg)", offset: 0.22 },
  { transform: "rotate(-4deg)", offset: 0.5 },
  { transform: "rotate(2deg)", offset: 0.76 },
  { transform: "rotate(0deg)" },
];
const SLIDE: Keyframe[] = [
  { transform: "translateY(70%)", opacity: 0 },
  { transform: "translateY(0)", opacity: 1 },
];
const DRAW: Keyframe[] = [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }];
const SETTLE = "cubic-bezier(0.34, 1.3, 0.64, 1)";

export function Tag({ currentCents, previousCents, inline = false }: { currentCents: number; previousCents: number | null; inline?: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  const price = useRef<HTMLSpanElement>(null);
  const old = useRef<HTMLElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const shown = useRef(currentCents);

  useLayoutEffect(() => {
    if (shown.current === currentCents) return;
    shown.current = currentCents;
    if (reducedMotion()) return;
    card.current?.animate(SWING, { duration: 640, easing: "ease-in-out" });
    price.current?.animate(SLIDE, { duration: 320, easing: SETTLE });
    const struck = old.current;
    if (struck && line.current) {
      struck.classList.add("drawing");
      line.current.animate(DRAW, { duration: 320, easing: SETTLE }).addEventListener("finish", () => struck.classList.remove("drawing"));
    }
  }, [currentCents]);

  return (
    <div className={inline ? "tag-hang inline" : "tag-hang"}>
      <svg className="tag-string" viewBox="0 0 20 34" aria-hidden="true" focusable="false">
        <circle cx="16" cy="3" r="2.5" fill="var(--ink)" />
        <path d="M16 3 Q6 14 10 34" fill="none" stroke="var(--ink)" strokeWidth="1" />
      </svg>
      <div className="tag" data-tag="" ref={card}>
        <span className="tag-hole" aria-hidden="true" />
        <span className="tag-prices num">
          {previousCents !== null && (
            <s className="tag-old" data-old-price="" ref={old}>
              {formatMoney(previousCents)}
              <span className="tag-strike" ref={line} aria-hidden="true" />
            </s>
          )}
          <span className="tag-price" data-price="" ref={price}>
            {formatMoney(currentCents)}
          </span>
        </span>
      </div>
    </div>
  );
}
