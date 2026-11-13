import { useEffect, useRef, type ReactElement } from "react";
import { useMotion } from "../lib/motion";

interface Props {
  price: string;
  km: number;
}

/** A large tabular figure whose changed digits roll in from below, with the km figure under it. */
export function RollingPrice({ price, km }: Props): ReactElement {
  const motion = useMotion("price-roll");
  const previous = useRef({ price, km });
  const root = useRef<HTMLDivElement | null>(null);
  const play = motion.play;
  const ms = motion.ms;

  useEffect(() => {
    const before = previous.current;
    previous.current = { price, km };
    if (before.price === price && before.km === km) return;
    play();
    if (ms === 0) return;
    root.current?.querySelectorAll<HTMLElement>("[data-roll]").forEach((node) => {
      const index = Number(node.dataset.roll);
      if (node.dataset.kind === "km" ? String(km) !== String(before.km) : before.price[index] !== price[index]) {
        node.animate(
          { transform: ["translateY(0.7em)", "translateY(0)"], opacity: [0, 1] },
          { duration: ms, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
    });
  }, [price, km, play, ms]);

  return (
    <div ref={root} className="span-figure" data-motion="price-roll" data-motion-ms={motion.ms} data-state={motion.state}>
      <span className="span-price">
        {Array.from(price).map((char, index) => (
          <span key={index} data-roll={index} className="digit">
            {char}
          </span>
        ))}
      </span>
      <span className="span-km">
        <span data-roll="0" data-kind="km" className="digit">
          {km}
        </span>{" "}
        km
      </span>
    </div>
  );
}
