import type { ReactNode } from "react";

export type LayerName = "back" | "middle" | "front";
export type Slug = "kitchen" | "fashion" | "electronics" | "beverages";

type Art = Record<LayerName, ReactNode>;

const wave = (y: number): string => `M0 ${y} Q150 ${y - 40} 300 ${y} T600 ${y} T900 ${y} T1200 ${y} V1200 H0 Z`;

function Pot({ x, y, scale }: { x: number; y: number; scale: number }): ReactNode {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect className="art-steel-dark" x="-190" y="-60" width="60" height="26" rx="13" />
      <rect className="art-steel-dark" x="130" y="-60" width="60" height="26" rx="13" />
      <rect className="art-steel-mid" x="-150" y="-80" width="300" height="170" rx="26" />
      <rect className="art-steel-dark" x="60" y="-80" width="90" height="170" rx="26" />
      <rect className="art-steel-light" x="-100" y="-80" width="30" height="170" />
      <path className="art-steel-mid" d="M-150 -80 A150 90 0 0 1 150 -80 Z" />
      <path className="art-steel-dark" d="M60 -80 A150 90 0 0 1 150 -80 Z" />
      <rect className="art-steel-light" x="-100" y="-150" width="30" height="70" />
      <circle className="art-black" cx="0" cy="-168" r="16" />
    </g>
  );
}

function Bottle({ x, y, scale }: { x: number; y: number; scale: number }): ReactNode {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect className="art-steel-mid" x="-60" y="-40" width="120" height="260" rx="40" />
      <rect className="art-steel-mid" x="-26" y="-120" width="52" height="100" rx="16" />
      <rect className="art-steel-dark" x="22" y="-40" width="38" height="260" rx="19" />
      <rect className="art-steel-light" x="-38" y="-10" width="18" height="190" rx="9" />
      <rect className="art-pink" x="-34" y="-150" width="68" height="46" rx="14" />
    </g>
  );
}

const ART: Record<Slug, Art> = {
  kitchen: {
    back: (
      <>
        <circle className="art-yellow" cx="900" cy="600" r="340" />
        <circle className="art-ground" cx="1090" cy="240" r="96" />
        <circle className="art-black" cx="230" cy="930" r="150" />
        <circle className="art-yellow" cx="120" cy="320" r="70" />
      </>
    ),
    middle: (
      <>
        <Pot x={880} y={640} scale={1.15} />
        <circle className="art-ground" cx="360" cy="360" r="46" />
        <rect className="art-black" x="250" y="760" width="170" height="26" rx="13" />
      </>
    ),
    front: (
      <>
        <path className="art-black" d={wave(745)} />
        <circle className="art-yellow" cx="1010" cy="700" r="30" />
      </>
    ),
  },
  fashion: {
    back: (
      <>
        <rect className="art-pink" x="760" y="260" width="320" height="320" transform="rotate(45 920 420)" />
        <circle className="art-ground" cx="1040" cy="800" r="150" />
        <rect className="art-black" x="150" y="840" width="180" height="180" transform="rotate(45 240 930)" />
        <circle className="art-pink" cx="200" cy="300" r="80" />
      </>
    ),
    middle: (
      <>
        <path className="art-ground" d="M760 330 L880 290 Q920 340 960 290 L1080 330 L1150 470 L1060 510 L1030 450 V820 H810 V450 L780 510 L690 470 Z" />
        <rect className="art-yellow" x="810" y="780" width="220" height="22" />
        <rect className="art-yellow" x="810" y="740" width="220" height="10" />
        <circle className="art-black" cx="420" cy="440" r="40" />
      </>
    ),
    front: (
      <>
        <path className="art-black" d="M0 790 L100 740 L200 790 L300 740 L400 790 L500 740 L600 790 L700 740 L800 790 L900 740 L1000 790 L1100 740 L1200 790 V1200 H0 Z" />
        <circle className="art-pink" cx="1010" cy="690" r="26" />
      </>
    ),
  },
  electronics: {
    back: (
      <>
        <circle className="art-raised" cx="900" cy="600" r="380" />
        <circle className="art-black" cx="900" cy="600" r="270" />
        <circle className="art-raised" cx="900" cy="600" r="160" />
        <circle className="art-pink" cx="200" cy="320" r="56" />
      </>
    ),
    middle: (
      <>
        <rect className="art-yellow" x="740" y="360" width="340" height="560" rx="40" />
        <rect className="art-black" x="900" y="360" width="180" height="560" rx="40" opacity="0.18" />
        <circle className="art-black" cx="910" cy="520" r="96" />
        <circle className="art-pink" cx="910" cy="520" r="40" />
        <circle className="art-black" cx="910" cy="760" r="64" />
        <circle className="art-yellow" cx="910" cy="760" r="24" />
      </>
    ),
    front: (
      <>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((bar) => (
          <rect key={bar} className="art-pink" x={60 + bar * 100} y={790 - ((bar * 7) % 5) * 18} width="56" height="600" rx="28" />
        ))}
      </>
    ),
  },
  beverages: {
    back: (
      <>
        <circle className="art-yellow" cx="930" cy="440" r="150" />
        <circle className="art-pink" cx="1080" cy="800" r="100" />
        <circle className="art-yellow" cx="660" cy="700" r="60" />
        <circle className="art-black" cx="250" cy="880" r="130" />
      </>
    ),
    middle: (
      <>
        <Bottle x={820} y={560} scale={1.3} />
        <Bottle x={1050} y={640} scale={1} />
        <circle className="art-ink" cx="620" cy="420" r="26" />
      </>
    ),
    front: (
      <>
        <path className="art-pink" d={wave(745)} />
        <circle className="art-yellow" cx="1010" cy="690" r="30" />
      </>
    ),
  },
};

/** Flat vector art for one layer of one category banner. */
export function CategoryLayer({ slug, layer }: { slug: Slug; layer: LayerName }): ReactNode {
  return (
    <svg viewBox="0 0 1200 1200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {ART[slug][layer]}
    </svg>
  );
}
