import { Fragment, type ElementType, type ReactNode } from "react";
import { cssVarsOf } from "../lib/cssVars.ts";
import { useSeenOnce } from "../lib/motion.ts";

/** Fades up and comes into focus once, the first time it is seen. `index` staggers siblings by a tenth of a second. */
export function Reveal({ as: Tag = "div", index = 0, className = "", children }: {
  as?: ElementType;
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  const [ref, seen] = useSeenOnce<HTMLElement>();
  return (
    <Tag ref={ref} className={`reveal ${seen ? "is-in" : ""} ${className}`.trim()} style={cssVarsOf({ "--i": index })}>
      {children}
    </Tag>
  );
}

/** A section heading whose letters settle left to right; its accessible name is always the whole text. */
export function SplitHeading({ text, level = 2, className = "" }: { text: string; level?: 1 | 2; className?: string }) {
  const [ref, seen] = useSeenOnce<HTMLHeadingElement>();
  const Tag = level === 1 ? "h1" : "h2";
  let position = 0;
  return (
    <Tag ref={ref} aria-label={text} className={`split ${seen ? "is-in" : ""} ${className}`.trim()}>
      {text.split(" ").map((word, index) => (
        <Fragment key={index}>
          {index > 0 && " "}
          <span className="split__word" aria-hidden="true">
            {Array.from(word).map((letter) => (
              <span key={position} className="split__letter" style={cssVarsOf({ "--i": position++ })}>{letter}</span>
            ))}
          </span>
        </Fragment>
      ))}
    </Tag>
  );
}
