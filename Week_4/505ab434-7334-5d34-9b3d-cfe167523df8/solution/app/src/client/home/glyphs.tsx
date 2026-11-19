// The eight tile glyphs: flat inline vector art in two or three shades of each tile's hue, drawn for this product.
import type { ReactNode } from "react";
import { QuenbyMark } from "../ui/Glyphs.tsx";
import type { TileId } from "./layout.ts";

const dark = "var(--g-dark)";
const mid = "var(--g-mid)";
const light = "var(--g-light)";

/** A filled disc with a tapering tail: one quotation mark. */
function QuoteMark({ x, y, flip = false }: { x: number; y: number; flip?: boolean }): ReactNode {
  return (
    <g transform={`translate(${x} ${y})${flip ? " rotate(180)" : ""}`} fill={dark}>
      <circle cx="0" cy="0" r="21" />
      <path d="M-20 4C-20 26 -30 40 -46 50C-22 50 -2 38 21 -2Z" />
    </g>
  );
}

const GLYPHS: Record<TileId, () => ReactNode> = {
  logo: () => <QuenbyMark label={false} size={116} className="glyph glyph-logo" />,
  colour: () => (
    <svg className="glyph glyph-colour" viewBox="0 0 130 130" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="78" height="78" fill={mid} />
      <rect x="22" y="22" width="46" height="46" fill={light} />
      <rect x="46" y="46" width="78" height="78" fill={dark} />
      <rect x="62" y="62" width="46" height="46" fill={mid} />
    </svg>
  ),
  typography: () => (
    <svg className="glyph glyph-type" viewBox="0 0 210 130" aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d="M8 118L52 5H80L124 118H98L88.5 92H43.5L34 118ZM51 71H81L66 30Z" fill={dark} />
      <path fillRule="evenodd" d="M166 38a40 40 0 1 0 0 80a40 40 0 1 0 0-80ZM163 58a20 20 0 1 1 0 40a20 20 0 1 1 0-40Z" fill={mid} />
      <rect x="184" y="38" width="22" height="80" fill={mid} />
    </svg>
  ),
  iconography: () => (
    <svg className="glyph glyph-parcel" viewBox="0 0 140 140" aria-hidden="true" focusable="false">
      <path d="M70 12L128 40L70 68L12 40Z" fill={light} />
      <path d="M12 40L70 68V128L12 100Z" fill={mid} />
      <path d="M128 40L70 68V128L128 100Z" fill={dark} />
      <path d="M41 26L99 54V72L87 66V60L29 32Z" fill={dark} opacity="0.55" />
    </svg>
  ),
  motion: () => (
    <svg className="glyph glyph-ease" viewBox="0 0 120 170" aria-hidden="true" focusable="false">
      <path d="M20 152C70 152 50 18 100 18" fill="none" stroke={dark} strokeWidth="2" />
      <path d="M20 152H44M100 18H76" stroke={dark} strokeWidth="1.5" />
      <rect x="10" y="144" width="16" height="16" rx="4" fill={dark} />
      <rect x="42" y="144" width="12" height="12" rx="3" fill={mid} />
      <rect x="94" y="10" width="16" height="16" rx="4" fill={dark} />
      <rect x="66" y="12" width="12" height="12" rx="3" fill={mid} />
    </svg>
  ),
  voice: () => (
    <svg className="glyph glyph-quote" viewBox="0 0 300 170" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <QuoteMark x={52} y={44} flip />
      <QuoteMark x={112} y={44} flip />
      <QuoteMark x={248} y={126} />
      <QuoteMark x={188} y={126} />
    </svg>
  ),
  library: () => (
    <svg className="glyph glyph-lock" viewBox="0 0 120 150" aria-hidden="true" focusable="false">
      <path d="M32 68V46a28 28 0 0 1 56 0v22" fill="none" stroke={dark} strokeWidth="10" />
      <rect x="14" y="66" width="92" height="76" rx="6" fill="none" stroke={dark} strokeWidth="10" />
      <circle cx="60" cy="98" r="9" fill={mid} />
      <rect x="55" y="102" width="10" height="22" fill={mid} />
    </svg>
  ),
  rules: () => (
    <svg className="glyph glyph-bars" viewBox="0 0 160 150" aria-hidden="true" focusable="false">
      <path d="M22 24V126" stroke={dark} strokeWidth="2" />
      <rect x="16" y="18" width="12" height="12" fill={dark} />
      <rect x="16" y="70" width="12" height="12" fill={dark} />
      <rect x="16" y="120" width="12" height="12" fill={dark} />
      <rect x="40" y="14" width="108" height="22" fill={dark} />
      <rect x="40" y="64" width="78" height="22" fill={mid} />
      <rect x="40" y="114" width="94" height="22" fill={light} />
    </svg>
  ),
};

export const TileGlyph = ({ id }: { id: TileId }): ReactNode => GLYPHS[id]();
