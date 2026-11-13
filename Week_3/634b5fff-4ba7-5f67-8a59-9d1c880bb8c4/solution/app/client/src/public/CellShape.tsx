import type { CellState } from "../../../shared/domain.js";

/** A box drawn for the shelf without WebGL: a closed lid, a standing match, a lit match, a notched corner. */

const Body = () => (
  <>
    <rect x="4" y="12" width="24" height="16" className="shape__box" />
    <rect x="3" y="9" width="26" height="5" className="shape__lid" />
    <line x1="4" y1="14" x2="28" y2="14" className="shape__seam" />
  </>
);

export const CellShape = ({ state }: { state: CellState }) => (
  <svg viewBox="0 0 32 32" className={`shape shape--${state}`} aria-hidden="true" focusable="false">
    {state === "taken" ? (
      <>
        <path d="M4 12 H21 L28 19 V28 H4 Z" className="shape__box" />
        <path d="M3 9 H19 L29 19 V14 H3 Z" className="shape__lid" />
        <path d="M21 12 L28 19" className="shape__seam" />
      </>
    ) : (
      <Body />
    )}
    {state === "held" || state === "yours" ? (
      <>
        <line x1="16" y1="9" x2="16" y2="2" className="shape__stick" />
        <circle cx="16" cy="2" r="1.6" className={state === "yours" ? "shape__head shape__head--lit" : "shape__head"} />
        {state === "yours" ? <path d="M16 -1 C13 2 13 4 16 4.6 C19 4 19 2 16 -1 Z" className="shape__flame" /> : null}
      </>
    ) : null}
  </svg>
);
