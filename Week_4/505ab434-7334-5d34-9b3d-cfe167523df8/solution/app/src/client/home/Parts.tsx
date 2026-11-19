import type { ReactNode, Ref } from "react";
import { QuenbyMark } from "../ui/Glyphs.tsx";

const OPENING = ["Quenby & Co. is not a", "mood board. It is a set", "of rules, each with a", "name you can cite."];

/** Two stacked chevrons: the jump-to-chapters cue. */
function Chevrons(): ReactNode {
  return (
    <svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true" focusable="false">
      <path d="M5 6L15 15L25 6M5 15L15 24L25 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
    </svg>
  );
}

/** The four-line opening statement with the small mark and the cue in its bottom row. */
export function HeroContent({ onJump, cue }: { onJump: () => void; cue?: Ref<HTMLButtonElement> }): ReactNode {
  return (
    <>
      <h1 className="hero-title">
        {OPENING.map((line) => (
          <span key={line}>{line} </span>
        ))}
      </h1>
      <div className="hero-foot">
        <QuenbyMark size={34} />
        <button type="button" className="cue" ref={cue} onClick={onJump}>
          <Chevrons />
          <span className="visually-hidden">Jump to chapters</span>
        </button>
      </div>
    </>
  );
}

export function PromiseContent({ statementRef }: { statementRef?: Ref<HTMLParagraphElement> }): ReactNode {
  return (
    <>
      <p className="promise-statement" ref={statementRef}>
        Every colour, letter, mark and move here is a rule with an identifier. Ask for what you need by name, and we answer by name.
      </p>
      <QuenbyMark size={46} className="promise-mark" />
    </>
  );
}
