import { useId, type CSSProperties, type ReactNode } from 'react';
import type { Fill, Format } from '../../shared/api.js';

// The four procedural objects, drawn in flat fills: a tall single-handled cup, a two-handled loving cup,
// a ring medal and a stacked trio of counters. Colour comes from the tile or tournament fill.
function SingleCup(): ReactNode {
  const clip = useId();
  return (
    <g transform="translate(200 556) scale(1.2) translate(-200 -556)">
      <defs><clipPath id={clip}><path d="M96 132H304C304 292 252 424 200 424C148 424 96 292 96 132Z" /></clipPath></defs>
      <rect className="o-ink" x="104" y="528" width="192" height="28" rx="4" />
      <rect className="o-ink" x="128" y="504" width="144" height="28" rx="4" />
      <path className="o-ink" d="M176 504L184 420H216L224 504Z" />
      <ellipse className="o-deep" cx="200" cy="464" rx="36" ry="13" />
      <path className="o-handle" d="M298 172C392 172 392 304 266 352" />
      <path className="o-tone" d="M96 132H304C304 292 252 424 200 424C148 424 96 292 96 132Z" />
      <g clipPath={`url(#${clip})`}>
        <rect className="o-light" x="96" y="132" width="52" height="300" />
        <rect className="o-ink" x="90" y="196" width="220" height="24" />
      </g>
      <rect className="o-ink" x="88" y="112" width="224" height="30" rx="8" />
    </g>
  );
}

function LovingCup(): ReactNode {
  const clip = useId();
  return (
    <g transform="translate(200 556) scale(1.03) translate(-200 -556)">
      <defs><clipPath id={clip}><path d="M112 156H288C330 262 272 392 200 404C128 392 70 262 112 156Z" /></clipPath></defs>
      <rect className="o-ink" x="100" y="530" width="200" height="26" rx="4" />
      <rect className="o-ink" x="132" y="506" width="136" height="28" rx="4" />
      <path className="o-ink" d="M180 506L186 400H214L220 506Z" />
      <path className="o-handle" d="M126 204C14 204 14 340 148 364" />
      <path className="o-handle" d="M274 204C386 204 386 340 252 364" />
      <path className="o-tone" d="M112 156H288C330 262 272 392 200 404C128 392 70 262 112 156Z" />
      <g clipPath={`url(#${clip})`}>
        <rect className="o-light" x="70" y="156" width="64" height="260" />
        <rect className="o-ink" x="60" y="236" width="280" height="22" />
      </g>
      <rect className="o-ink" x="100" y="142" width="200" height="26" rx="8" />
      <path className="o-deep" d="M120 144C128 70 272 70 280 144Z" />
      <rect className="o-ink" x="190" y="44" width="20" height="30" />
      <circle className="o-ink" cx="200" cy="38" r="18" />
    </g>
  );
}

function Medal(): ReactNode {
  return (
    <>
      <path className="o-ink" d="M126 0H190L238 196H176Z" />
      <path className="o-deep" d="M274 0H210L162 196H224Z" />
      <circle className="o-ringhole" cx="200" cy="210" r="26" />
      <path className="o-tone" fillRule="evenodd"
        d="M200 214A164 164 0 1 0 200 542A164 164 0 1 0 200 214ZM200 288A90 90 0 1 1 200 468A90 90 0 1 1 200 288Z" />
      <circle className="o-edge" cx="200" cy="378" r="132" />
      <path className="o-light" d="M96 330A112 112 0 0 1 176 262A140 140 0 0 0 120 380Z" />
      <circle className="o-hole" cx="200" cy="378" r="86" />
    </>
  );
}

function Counters(): ReactNode {
  const discs: Array<[number, number, string]> = [[388, -16, 'o-ink'], [296, 14, 'o-tone'], [204, -8, 'o-deep']];
  return (
    <g transform="translate(200 556) scale(1.7) translate(-200 -482)">
      {discs.map(([y, shift, tone]) => (
        <g key={y} transform={`translate(${shift} 0)`}>
          <rect className={tone} x="70" y={y} width="260" height="58" />
          <ellipse className={tone} cx="200" cy={y + 58} rx="130" ry="36" />
          <ellipse className="o-light" cx="200" cy={y} rx="130" ry="36" />
          <ellipse className="o-edge" cx="200" cy={y} rx="96" ry="24" />
        </g>
      ))}
    </g>
  );
}

const DRAWINGS: Record<Format, () => ReactNode> = {
  single_elimination: SingleCup,
  double_elimination: LovingCup,
  round_robin: Medal,
  swiss: Counters,
};

// The tile fill (or the tournament fill, for trophies) tints the object.
export function FormatObject({ format, fill, label, className }: {
  format: Format;
  fill: Fill;
  label: string;
  className?: string;
}): ReactNode {
  const Drawing = DRAWINGS[format];
  return (
    <svg role="img" aria-label={label} viewBox="0 0 400 560" className={`object ${className ?? ''}`}
      style={{ '--tile': `var(--${fill})` } as CSSProperties}>
      <Drawing />
    </svg>
  );
}
