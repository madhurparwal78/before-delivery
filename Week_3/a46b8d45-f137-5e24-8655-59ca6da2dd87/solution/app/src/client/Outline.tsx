/** Procedural outlines for the fitting fan: each part is drawn as the real fitting, sized by its longest side. */

type Kind = "pin" | "cam" | "bolt" | "bracket" | "upright" | "shelf" | "rail" | "panel";

function kindOf(name: string): Kind {
  const n = name.toLowerCase();
  if (/cam lock/.test(n)) return "cam";
  if (/pin/.test(n)) return "pin";
  if (/bolt|screw/.test(n)) return "bolt";
  if (/bracket|block|corner/.test(n)) return "bracket";
  if (/upright|leg|post/.test(n)) return "upright";
  if (/shelf/.test(n)) return "shelf";
  if (/rail|slat|brace|bar/.test(n)) return "rail";
  return "panel";
}

/** A size factor from the part's longest side: a 15 mm cam lock must not read like a 1,990 mm panel. */
function scaleOf(longestSideMm: number): number {
  if (longestSideMm >= 1500) return 1;
  if (longestSideMm >= 800) return 0.86;
  if (longestSideMm >= 300) return 0.68;
  if (longestSideMm >= 100) return 0.52;
  return 0.4;
}

interface Drawing {
  shape: preact.JSX.Element;
  detail: preact.JSX.Element | null;
  corners: { right: [number, number]; left: [number, number] };
}

function draw(kind: Kind, k: number): Drawing {
  switch (kind) {
    case "panel": {
      const w = 22 + 32 * k;
      return {
        shape: <rect x={-w / 2} y={-13} width={w} height={26} rx={1} />,
        detail: (
          <g>
            <circle cx={-w / 2 + 6} cy={0} r={2} />
            <circle cx={w / 2 - 6} cy={0} r={2} />
            <path d={`M ${-w / 2 + 12} -7 H ${w / 2 - 12}`} />
          </g>
        ),
        corners: { right: [w / 2, -13], left: [-w / 2, -13] },
      };
    }
    case "shelf": {
      const w = 24 + 30 * k;
      return {
        shape: <path d={`M ${-w / 2} -7 H ${w / 2} V 7 H ${-w / 2} Z`} />,
        detail: <path d={`M ${-w / 2} 3 H ${w / 2}`} />,
        corners: { right: [w / 2, -7], left: [-w / 2, -7] },
      };
    }
    case "rail": {
      const w = 24 + 32 * k;
      return {
        shape: <rect x={-w / 2} y={-4} width={w} height={8} rx={1} />,
        detail: (
          <g>
            <circle cx={-w / 2 + 4} cy={0} r={1.4} />
            <circle cx={w / 2 - 4} cy={0} r={1.4} />
          </g>
        ),
        corners: { right: [w / 2, -4], left: [-w / 2, -4] },
      };
    }
    case "upright": {
      const h = 22 + 24 * k;
      return {
        shape: <rect x={-6} y={-h / 2} width={12} height={h} rx={1} />,
        detail: <path d={`M -6 ${h / 2 - 6} H 6 M 0 ${-h / 2 + 4} V ${-h / 2 + 10}`} />,
        corners: { right: [6, -h / 2], left: [-6, -h / 2] },
      };
    }
    case "bracket":
      return {
        shape: <path d="M -12 -14 H -3 V 6 H 14 V 14 H -12 Z" />,
        detail: <g><circle cx={-7.5} cy={-8} r={1.6} /><circle cx={8} cy={10} r={1.6} /></g>,
        corners: { right: [-3, -14], left: [-12, -14] },
      };
    case "pin":
      return {
        shape: <path d="M -14 -3 H 8 L 14 0 L 8 3 H -14 Z" />,
        detail: <path d="M -14 -3 V 3" />,
        corners: { right: [14, 0], left: [-14, -3] },
      };
    case "bolt":
      return {
        shape: <path d="M -14 -6 L -8 -9 L -2 -6 V 6 L -8 9 L -14 6 Z M -2 -2.5 H 14 V 2.5 H -2" />,
        detail: <path d="M 4 -2.5 V 2.5 M 8 -2.5 V 2.5 M 12 -2.5 V 2.5" />,
        corners: { right: [14, 0], left: [-14, -9] },
      };
    case "cam":
      return {
        shape: <circle cx={0} cy={0} r={10} />,
        detail: <path d="M -6 0 H 6 M 0 -10 V -5" />,
        corners: { right: [7, -7], left: [-7, -7] },
      };
  }
}

interface OutlineProps {
  name: string;
  longestSideMm: number;
  bookletNumber: number;
  /** Position in booklet order: odd parts lead their callout up-left so neighbouring leaders do not stack. */
  index: number;
}

/** The drawing is enlarged inside the cell; strokes stay at their pixel widths and the number stays a true 12 px. */
const ENLARGE = 2.4;

/** One part's outline with its hairline callout ending in the booklet number (mono). */
export function Outline({ name, longestSideMm, bookletNumber, index }: OutlineProps) {
  const { shape, detail, corners } = draw(kindOf(name), scaleOf(longestSideMm));
  const leftward = index % 2 === 1;
  const [cx, cy] = leftward ? corners.left : corners.right;
  const endX = leftward ? Math.min(cx - 8, -26) : Math.max(cx + 8, 26);
  const endY = Math.min(cy - 8, -22);
  return (
    <svg viewBox="-120 -90 240 180" aria-hidden="true" focusable="false">
      <g transform={`scale(${ENLARGE})`}>
        <g class="raise">
          <g class="shape">{shape}</g>
          {detail ? <g class="detail">{detail}</g> : null}
        </g>
        <path class="callout" d={`M ${cx} ${cy} L ${endX} ${endY}`} />
      </g>
      <text class="callout-no" x={endX * ENLARGE + (leftward ? -3 : 3)} y={endY * ENLARGE + 4} text-anchor={leftward ? "end" : "start"}>
        {bookletNumber}
      </text>
    </svg>
  );
}
