import type { ReactElement } from "react";
import type { Plate } from "../../../shared/domain.js";
import { seeded } from "../scene/random.js";

/** The procedural drawing of a plate, shown until art is uploaded: a white-line wood engraving, cut out of a block of ink. */

const SIZE = 240;
const BLOCK = { from: 9, to: 231 };

const taper = (x1: number, y1: number, x2: number, y2: number, width: number): string => {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / length) * (width / 2);
  const ny = ((x2 - x1) / length) * (width / 2);
  return `M${(x1 + nx).toFixed(1)} ${(y1 + ny).toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}L${(x1 - nx).toFixed(1)} ${(y1 - ny).toFixed(1)}Z`;
};

/** The engraver's burst of light: paper-coloured wedges, thick at the centre's side and running out to a point. */
const Rays = ({ x, y, from, to, count, seed }: { x: number; y: number; from: number; to: number; count: number; seed: number }) => {
  const rand = seeded(seed);
  let d = "";
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.03;
    const reach = to * (0.55 + rand() * 0.45);
    const start = from + rand() * 5;
    d += taper(x + Math.cos(angle) * start, y + Math.sin(angle) * start, x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, 0.8 + rand() * 1.5);
  }
  return <path d={d} className="art__paper" />;
};

/** Falling snow: small paper flecks scattered over the block. */
const Snow = ({ seed, count, floor }: { seed: number; count: number; floor: number }) => {
  const rand = seeded(seed);
  let d = "";
  for (let i = 0; i < count; i += 1) {
    const x = BLOCK.from + 4 + rand() * (BLOCK.to - BLOCK.from - 8);
    const y = BLOCK.from + 4 + rand() * (floor - BLOCK.from - 8);
    const r = 0.5 + rand() * 0.9;
    d += `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(r * 2).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-r * 2).toFixed(1)} 0`;
  }
  return <path d={d} className="art__paper" />;
};

/** Parallel engraved lines across the whole plate at `angle` degrees, cut to `clip`. */
const Hatch = ({ clip, angle, gap, weight }: { clip: string; angle: number; gap: number; weight: number }) => {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let d = "";
  for (let offset = -SIZE; offset <= SIZE; offset += gap) {
    const cx = SIZE / 2 - sin * offset;
    const cy = SIZE / 2 + cos * offset;
    d += `M${(cx - cos * SIZE).toFixed(1)} ${(cy - sin * SIZE).toFixed(1)}L${(cx + cos * SIZE).toFixed(1)} ${(cy + sin * SIZE).toFixed(1)}`;
  }
  return <path d={d} className="art__hatch" strokeWidth={weight} clipPath={`url(#${clip})`} />;
};

/** A paper shape with shading lines cut into it, and a closer second pass over its shadow side. */
const Shaded = ({ id, d, shadow, angle = 62, gap = 3.4 }: { id: string; d: string; shadow?: string; angle?: number; gap?: number }) => (
  <>
    <clipPath id={id}><path d={d} /></clipPath>
    {shadow ? <clipPath id={`${id}-s`}><path d={shadow} /></clipPath> : null}
    <path d={d} className="art__paper" />
    <Hatch clip={id} angle={angle} gap={gap * 2} weight={0.55} />
    {shadow ? <Hatch clip={`${id}-s`} angle={angle} gap={gap} weight={1.25} /> : null}
    {shadow ? <Hatch clip={`${id}-s`} angle={angle + 74} gap={gap * 1.6} weight={0.7} /> : null}
  </>
);

/** A snow drift along the foot of the block. */
const Drift = ({ id, y }: { id: string; y: number }) => (
  <Shaded
    id={id}
    d={`M9 ${y + 8} C40 ${y - 8} 76 ${y + 4} 112 ${y} C150 ${y - 5} 196 ${y + 8} 231 ${y - 4} V231 H9 Z`}
    shadow={`M9 ${y + 20} C60 ${y + 10} 120 ${y + 24} 231 ${y + 12} V231 H9 Z`}
    angle={4}
    gap={3}
  />
);

const Stove = () => (
  <>
    <Rays x={120} y={118} from={58} to={112} count={64} seed={11} />
    <Snow seed={12} count={26} floor={184} />
    <Drift id="stove-drift" y={200} />
    <Shaded id="stove-pipe" d="M100 78 V38 H68 V9 H54 V50 H88 V78 Z" shadow="M61 9 H68 V38 H100 V78 H94 V44 H61 Z" angle={0} gap={2.6} />
    {/* claw feet in brass */}
    <path d="M82 180 C76 192 70 196 64 206 H82 C86 198 90 192 94 182 Z M158 180 C164 192 170 196 176 206 H158 C154 198 150 192 146 182 Z" className="art__paper" />
    <path d="M70 203 H80 M160 203 H170" className="art__inkline" strokeWidth={1.4} />
    {/* the round belly, shaded towards its right */}
    <Shaded
      id="stove-belly"
      d="M84 88 H156 C172 112 174 150 158 182 H82 C66 150 68 112 84 88 Z"
      shadow="M136 88 H156 C172 112 174 150 158 182 H140 C150 150 148 112 136 88 Z"
      angle={90}
      gap={2.8}
    />
    <rect x="76" y="82" width="88" height="8" className="art__ink" />
    <rect x="72" y="76" width="96" height="6" className="art__paper" />
    <rect x="74" y="178" width="92" height="7" className="art__ink" />
    <rect x="70" y="185" width="100" height="4" className="art__paper" />
    <path d="M84 100 H156 M80 168 H160" className="art__inkline" strokeWidth={1.6} />
    {/* the door and its fire */}
    <path d="M95 166 V132 A25 25 0 0 1 145 132 V166 Z" className="art__ink" />
    <path d="M100 162 V133 A20 20 0 0 1 140 133 V162 Z" fill="none" className="art__cut" strokeWidth={1.4} />
    <path d="M120 110 C126 122 134 130 134 144 C134 155 128 160 120 160 C112 160 106 155 106 144 C106 136 112 132 113 124 C116 128 118 122 120 110 Z" className="art__paper" />
    <path d="M120 130 C122 138 127 141 127 148 C127 154 124 157 120 157 C116 157 113 154 113 148 C113 142 118 139 120 130 Z" className="art__ink" />
    {/* the brass ornament */}
    <path d="M108 76 C110 68 112 66 116 64 C110 60 110 52 120 48 C130 52 130 60 124 64 C128 66 130 68 132 76 Z" className="art__paper" />
    <path d="M120 50 V62 M114 56 C116 60 124 60 126 56" className="art__inkline" strokeWidth={1} />
    <circle cx="120" cy="43" r="4" className="art__paper" />
  </>
);

const Goose = () => (
  <>
    <Rays x={118} y={102} from={70} to={112} count={58} seed={21} />
    <Snow seed={22} count={18} floor={156} />
    {/* the laid table */}
    <Shaded
      id="goose-table"
      d="M22 166 H218 L226 214 H14 Z"
      shadow="M22 196 H218 L226 214 H14 Z"
      angle={90}
      gap={3.2}
    />
    <path d={[taper(46, 170, 38, 214, 3), taper(82, 170, 76, 214, 3.6), taper(120, 170, 120, 214, 4), taper(158, 170, 164, 214, 3.6), taper(194, 170, 202, 214, 3)].join("")} className="art__ink" />
    <rect x="20" y="162" width="200" height="5" className="art__ink" />
    <path d={taper(30, 214, 28, 229, 7) + taper(210, 214, 212, 229, 7)} className="art__paper" />
    {/* the dish */}
    <path d="M42 150 C58 170 182 170 198 150 C186 158 54 158 42 150 Z" className="art__paper" />
    {/* the goose: full breast, long neck, and its dark folded wing */}
    <Shaded
      id="goose-body"
      d="M30 118 C42 124 46 118 58 110 C80 96 106 102 126 110 C142 116 150 106 150 92 C150 78 144 68 148 54 C152 40 170 36 180 46 C184 50 186 53 188 56 L208 64 L186 68 C178 74 172 84 172 98 C172 130 150 158 110 158 C78 158 52 146 30 118 Z"
      shadow="M58 146 C80 158 142 162 162 124 C168 112 172 106 172 98 C172 130 150 158 110 158 C90 158 72 154 58 146 Z"
      angle={18}
      gap={2.8}
    />
    <path d="M64 124 C84 104 120 108 144 132 C126 152 86 150 64 124 Z" className="art__ink" />
    <path d={[taper(74, 124, 134, 132, 2), taper(82, 118, 136, 136, 1.8), taper(78, 130, 126, 142, 1.6), taper(92, 114, 138, 130, 1.4)].join("")} className="art__paper" />
    <path d="M186 56 L208 64 L186 68 C184 64 184 60 186 56 Z" className="art__ink" />
    <circle cx="170" cy="52" r="2.6" className="art__ink" />
    {/* knife and fork in its breast */}
    <path d={taper(146, 124, 196, 84, 5) + "M194 80 L206 76 L200 90 Z"} className="art__paper" />
    <path d="M146 134 L196 108 M196 108 L208 96 M196 108 L210 101 M196 108 L212 107" className="art__cut" strokeWidth={2.2} />
  </>
);

const Tree = () => {
  const candles: readonly (readonly [number, number])[] = [
    [120, 42], [92, 76], [148, 76], [76, 112], [120, 96], [164, 112], [60, 150], [100, 136], [140, 136], [180, 150], [46, 190], [86, 176], [154, 176], [194, 190],
  ];
  return (
    <>
      <Rays x={120} y={104} from={48} to={112} count={70} seed={31} />
      <Snow seed={32} count={14} floor={196} />
      <Drift id="tree-drift" y={204} />
      <path d="M110 196 H130 V216 H110 Z" className="art__paper" />
      <path d="M116 196 V216 M124 196 V216" className="art__inkline" strokeWidth={1.2} />
      {/* three skirts of branches, each shaded along its right */}
      <Shaded
        id="tree-body"
        d="M120 28 L146 76 L134 72 L170 118 L152 112 L192 162 L170 156 L206 200 C170 208 70 208 34 200 L70 156 L48 162 L88 112 L70 118 L106 72 L94 76 Z"
        shadow="M120 28 L146 76 L134 72 L170 118 L152 112 L192 162 L170 156 L206 200 C184 204 150 206 124 206 L130 150 L126 96 Z"
        angle={112}
        gap={2.8}
      />
      <path d={[taper(94, 80, 148, 86, 3.5), taper(74, 122, 168, 126, 4), taper(52, 166, 188, 170, 4.5)].join("")} className="art__ink" />
      <path d="M78 96 C100 106 134 106 156 94 M60 138 C96 152 146 150 182 136 M44 180 C92 194 150 194 198 178" className="art__inkline" strokeWidth={1.6} />
      {/* the tapers: an ink stem and a cut flame on every branch end */}
      {candles.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x - 1.6} y={y - 1} width="3.2" height="9" className="art__ink" />
          <path d={`M${x} ${y - 11} C${x + 2.6} ${y - 7} ${x + 3.2} ${y - 5} ${x + 3.2} ${y - 3.6} C${x + 3.2} ${y - 1.6} ${x + 1.6} ${y - 1} ${x} ${y - 1} C${x - 1.6} ${y - 1} ${x - 3.2} ${y - 1.6} ${x - 3.2} ${y - 3.6} C${x - 3.2} ${y - 5} ${x - 2.6} ${y - 7} ${x} ${y - 11} Z`} className="art__paper" />
        </g>
      ))}
    </>
  );
};

const Star = () => {
  const rand = seeded(41);
  const streaks = Array.from({ length: 9 }, (_, i) => taper(170 - i * 2.8, 70 + i * 2.2, 26 + rand() * 40, 176 - i * 7 + rand() * 12, 6 - i * 0.45));
  return (
    <>
      <Snow seed={42} count={60} floor={170} />
      <Rays x={172} y={66} from={24} to={52} count={34} seed={43} />
      <path d={streaks.join("")} className="art__paper" />
      {/* the falling star: eight long points */}
      <path d="M172 34 L178 58 L204 66 L178 74 L172 98 L166 74 L140 66 L166 58 Z" className="art__paper" />
      <path d="M152 46 L168 62 M192 46 L176 62 M152 86 L168 70 M192 86 L176 70" className="art__cut" strokeWidth={3} />
      <circle cx="172" cy="66" r="4.5" className="art__ink" />
      {/* the roofs it falls behind */}
      <Shaded
        id="star-roofs"
        d="M9 186 L34 164 L58 186 V176 L92 146 L130 180 V170 L158 150 L190 178 L212 160 L231 176 V231 H9 Z"
        shadow="M92 146 L130 180 V231 H96 V190 Z M158 150 L190 178 V231 H164 V190 Z M34 164 L58 186 V231 H38 V192 Z"
        angle={90}
        gap={2.6}
      />
      <path d="M74 188 h14 v16 h-14 Z M104 196 h16 v18 h-16 Z M170 192 h12 v16 h-12 Z M200 196 h12 v16 h-12 Z" className="art__ink" />
      <path d="M81 188 v16 M112 196 v18 M176 192 v16 M206 196 v16" className="art__cut" strokeWidth={1.2} />
      <rect x="146" y="150" width="11" height="22" className="art__ink" />
    </>
  );
};

const Grandmother = () => (
  <>
    <Rays x={120} y={68} from={40} to={118} count={84} seed={51} />
    <path d="M78 68 A42 42 0 0 1 162 68" className="art__cut" strokeWidth={2} />
    {/* her skirts, heavy folds running out to points */}
    <Shaded
      id="gran-robe"
      d="M98 92 C80 104 64 150 46 214 C80 226 160 226 194 214 C176 150 160 104 142 92 C134 100 106 100 98 92 Z"
      shadow="M128 98 C136 96 140 94 142 92 C160 104 176 150 194 214 C176 220 154 222 136 223 C146 176 140 130 128 98 Z"
      angle={80}
      gap={2.8}
    />
    <path
      d={[taper(110, 104, 88, 220, 5), taper(120, 106, 120, 224, 6), taper(130, 104, 152, 220, 5), taper(100, 112, 64, 214, 3.4), taper(140, 112, 176, 214, 3.4)].join("")}
      className="art__ink"
    />
    {/* the shawl: a dark mass with cut fringe, and arms held out */}
    <path d="M96 90 C86 98 66 112 44 120 L50 132 C74 128 92 122 104 116 L120 136 L136 116 C148 122 166 128 190 132 L196 120 C174 112 154 98 144 90 C134 98 106 98 96 90 Z" className="art__ink" />
    <path d="M96 90 C86 98 66 112 44 120 L50 132 C74 128 92 122 104 116 L120 136 L136 116 C148 122 166 128 190 132 L196 120 C174 112 154 98 144 90" className="art__cut" strokeWidth={1.3} />
    <path d={[taper(104, 100, 60, 124, 1.6), taper(136, 100, 180, 124, 1.6), taper(112, 104, 120, 130, 1.4), taper(128, 104, 120, 130, 1.4)].join("")} className="art__paper" />
    <path d="M44 120 C40 124 40 130 42 134 L50 132 Z M196 120 C200 124 200 130 198 134 L190 132 Z" className="art__paper" />
    {/* her face in a dark kerchief, calm, looking down */}
    <path d="M92 70 C92 42 148 42 148 70 C148 86 136 98 120 98 C104 98 92 86 92 70 Z" className="art__ink" />
    <path d="M92 70 C92 42 148 42 148 70 C148 86 136 98 120 98 C104 98 92 86 92 70 Z" className="art__cut" strokeWidth={1} />
    <path d="M102 70 C102 54 138 54 138 70 C138 82 130 90 120 90 C110 90 102 82 102 70 Z" className="art__paper" />
    <path d="M108 69 C110 71 113 71 115 69 M125 69 C127 71 130 71 132 69 M114 80 C117 83 123 83 126 80" className="art__inkline" strokeWidth={1.3} />
    <path d="M120 72 V76" className="art__inkline" strokeWidth={0.9} />
    <path d="M139 72 C136 80 132 84 128 87 C134 86 138 82 139 72 Z" className="art__ink" />
  </>
);

const DRAWINGS: Record<Plate, () => ReactElement> = { Stove, Goose, Tree, Star, Grandmother };

export const PlateArt = ({ plate }: { plate: Plate }) => {
  const Drawing = DRAWINGS[plate];
  const inner = BLOCK.to - BLOCK.from;
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label={`Plate: ${plate}`} className="art">
      <rect x="1" y="1" width={SIZE - 2} height={SIZE - 2} className="art__frame" />
      <clipPath id={`block-${plate}`}><rect x={BLOCK.from} y={BLOCK.from} width={inner} height={inner} /></clipPath>
      <rect x={BLOCK.from} y={BLOCK.from} width={inner} height={inner} className="art__ink" />
      <g clipPath={`url(#block-${plate})`}><Drawing /></g>
    </svg>
  );
};
