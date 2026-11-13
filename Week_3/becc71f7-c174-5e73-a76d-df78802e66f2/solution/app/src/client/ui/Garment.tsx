// The generated garment drawings: each category has its silhouette on a hanger, and a piece's seed varies its cloth and folds.
import { useId } from "react";
import type { Category } from "../../shared/catalog";

const CLOTHS = ["var(--cloth-light)", "var(--cloth-mid)", "var(--cloth-deep)"];

interface Drawing {
  /** The cloth, filled and outlined. */
  body: string;
  /** Seams and details drawn in ink. */
  seams: string;
  /** Buttons, each at its centre. */
  buttons?: readonly (readonly [number, number])[];
  /** Where the fold lines may run; leather goods have none. */
  folds?: { top: number; bottom: number; left: number; right: number };
}

const DRAWINGS: Record<Category, Drawing> = {
  coats: {
    body: "M58 54 L80 62 L102 54 L124 66 L136 150 L120 154 L114 96 L116 196 L44 196 L46 96 L40 154 L24 150 L36 66 Z",
    seams: "M80 96 L80 196 M66 56 L60 78 L72 84 L80 96 M94 56 L100 78 L88 84 L80 96 M54 150 h16 M90 150 h16",
    buttons: [[88, 118], [88, 142]],
    folds: { top: 110, bottom: 192, left: 50, right: 110 },
  },
  jackets: {
    body: "M60 54 L80 62 L100 54 L124 66 L134 136 L118 140 L112 96 L112 150 L48 150 L48 96 L42 140 L26 136 L36 66 Z",
    seams: "M80 92 L80 150 M67 56 L62 74 L72 78 L80 92 M93 56 L98 74 L88 78 L80 92 M56 112 h16 M88 112 h16 M48 142 h64",
    folds: { top: 100, bottom: 146, left: 52, right: 108 },
  },
  dresses: {
    body: "M64 54 L70 54 L78 72 L82 72 L90 54 L96 54 L98 84 L92 104 L122 196 L38 196 L68 104 L62 84 Z",
    seams: "M68 104 Q80 110 92 104",
    folds: { top: 116, bottom: 192, left: 54, right: 106 },
  },
  knitwear: {
    body: "M60 54 Q80 66 100 54 L124 64 L140 140 L124 146 L112 96 L112 152 L48 152 L48 96 L36 146 L20 140 L36 64 Z",
    seams: "M60 54 Q80 72 100 54 M48 142 L112 142 M54 142 V152 M62 142 V152 M70 142 V152 M78 142 V152 M86 142 V152 M94 142 V152 M102 142 V152 M26 132 L38 136 M134 132 L122 136",
    folds: { top: 96, bottom: 136, left: 54, right: 106 },
  },
  shirts: {
    body: "M62 54 L80 60 L98 54 L122 66 L134 138 L120 142 L110 94 L110 160 L50 160 L50 94 L40 142 L26 138 L38 66 Z",
    seams: "M62 54 L72 72 L80 60 L88 72 L98 54 M80 60 L80 160 M90 90 h14 V104 h-14 Z",
    buttons: [[85, 82], [85, 104], [85, 126], [85, 148]],
    folds: { top: 106, bottom: 156, left: 54, right: 76 },
  },
  trousers: {
    body: "M54 56 L106 56 L114 196 L90 196 L80 96 L70 196 L46 196 Z",
    seams: "M54 66 L106 66 M64 66 L60 196 M96 66 L100 196 M80 66 L80 96 M62 56 V66 M98 56 V66",
    folds: { top: 104, bottom: 192, left: 50, right: 72 },
  },
  skirts: {
    body: "M58 56 L102 56 L128 170 Q80 186 32 170 Z",
    seams: "M56 66 L104 66 M68 66 L56 176 M80 66 L80 180 M92 66 L104 176",
    folds: { top: 90, bottom: 168, left: 46, right: 114 },
  },
  shoes: {
    body: "M20 88 L46 88 L47 126 Q49 138 60 144 Q76 151 76 166 L76 174 L40 174 L38 182 L20 182 Z M84 88 L110 88 L111 126 Q113 138 124 144 Q140 151 140 166 L140 174 L104 174 L102 182 L84 182 Z",
    seams: "M33 54 V88 M97 54 V88 M26 94 L28 122 Q33 130 38 122 L40 94 M90 94 L92 122 Q97 130 102 122 L104 94 M30.5 97 L32 122 M35.5 97 L34.5 122 M94.5 97 L96 122 M99.5 97 L98.5 122 M20 172 H40 M84 172 H104",
  },
  bags: {
    body: "M36 110 L124 110 L134 186 L26 186 Z",
    seams: "M56 110 Q56 46 80 46 Q104 46 104 110 M32 134 L128 134 M74 134 h12 v12 h-12 Z",
  },
  accessories: {
    body: "M56 46 L104 46 L100 60 L108 190 L84 196 L80 74 L76 150 L52 146 L60 60 Z",
    seams: "M56 46 Q80 66 104 46 M84 184 L108 178 M52 136 L76 140 M88 186 V196 M96 184 V194 M58 138 V146 M68 140 V148",
    folds: { top: 84, bottom: 178, left: 86, right: 100 },
  },
};

function seedOf(text: string): number {
  let seed = 7;
  for (const character of text) seed = (seed * 31 + Number(character.codePointAt(0))) % 9973;
  return seed;
}

export function Garment({ category, seed = category }: { category: Category; seed?: string }) {
  const { body, seams, buttons = [], folds } = DRAWINGS[category];
  const number = seedOf(seed);
  const clip = useId();
  const foldLines = !folds ? [] : Array.from({ length: 3 + (number % 3) }, (_, index) => {
    const x = folds.left + ((number * (index + 3) * 17) % Math.max(1, folds.right - folds.left));
    const lean = ((number * (index + 5)) % 15) - 7;
    const start = folds.top + ((number * (index + 2)) % 14);
    return `M${x} ${start} Q${x + lean} ${(start + folds.bottom) / 2} ${x + lean / 2} ${folds.bottom}`;
  });
  return (
    <svg className="garment" viewBox="0 0 160 200" aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M80 28 V20 Q80 16 84 14 Q90 10 86 6 Q80 2 75 8" />
        <path d="M80 28 L28 50 Q24 54 30 54 H130 Q136 54 132 50 Z" />
      </g>
      <clipPath id={clip}>
        <path d={body} />
      </clipPath>
      <path d={body} fill={CLOTHS[number % CLOTHS.length]} stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d={foldLines.join(" ")} clipPath={`url(#${clip})`} fill="none" stroke="var(--ink)" strokeOpacity="0.28" strokeWidth="1.2" strokeLinecap="round" />
      <path d={seams} fill="none" stroke="var(--ink)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      {buttons.map(([x, y]) => (
        <circle key={`${x} ${y}`} cx={x} cy={y} r="2.5" fill="var(--ink)" />
      ))}
    </svg>
  );
}
