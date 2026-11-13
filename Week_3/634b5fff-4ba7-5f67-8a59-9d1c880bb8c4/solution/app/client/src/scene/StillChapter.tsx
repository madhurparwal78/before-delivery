import { useId, type ReactElement, type ReactNode } from "react";
import type { Chapter } from "../../../shared/domain.js";
import { CHAPTER_TITLES } from "../../../shared/copy.js";

const GROUND = "#070B14";
const SNOW = "#E6EDF7";
const SULPHUR = "#F2C641";
const EMBER = "#E0562B";

const FLAKES: readonly [number, number, number][] = Array.from({ length: 70 }, (_, i) => [
  (i * 173) % 1200,
  (i * 331 + (i % 7) * 59) % 800,
  1 + ((i * 37) % 10) / 4,
]);

interface Ids {
  sky: string;
  snow: string;
  glow: string;
  streak: string;
  halo: string;
}

const Alley = ({ ids }: { ids: Ids }): ReactElement => (
  <g>
    <rect width="1200" height="800" fill={`url(#${ids.sky})`} />
    <polygon points="0,-40 440,236 440,548 0,820" fill="#0f1829" />
    <polygon points="1200,-40 760,236 760,548 1200,820" fill="#0d1526" />
    <rect x="440" y="236" width="320" height="312" fill="#0a1220" />
    <polygon points="0,820 440,548 760,548 1200,820" fill={`url(#${ids.snow})`} />
    {[0, 1, 2].map((row) =>
      [0, 1].map((column) => (
        <g key={`${row}-${column}`}>
          <polygon
            points={`${60 + column * 160},${120 + row * 190} ${150 + column * 160},${170 + row * 150} ${150 + column * 160},${240 + row * 150} ${60 + column * 160},${230 + row * 190}`}
            fill="#1a2a47"
            opacity="0.8"
          />
          <polygon
            points={`${1140 - column * 160},${120 + row * 190} ${1050 - column * 160},${170 + row * 150} ${1050 - column * 160},${240 + row * 150} ${1140 - column * 160},${230 + row * 190}`}
            fill="#1a2a47"
            opacity="0.8"
          />
        </g>
      )),
    )}
    <polygon points="0,610 70,560 70,330 0,360" fill="#162239" />
    <polygon points="520,300 680,300 680,548 520,548" fill="#0c1424" />
    <rect x="164" y="330" width="10" height="260" fill="#05080f" />
    <rect x="150" y="318" width="38" height="30" fill="#1c2942" />
    <rect x="1030" y="360" width="8" height="200" fill="#05080f" />
    <rect x="1018" y="350" width="32" height="26" fill="#1c2942" />
    <ellipse cx="300" cy="700" rx="230" ry="26" fill={SNOW} opacity="0.08" />
    <ellipse cx="880" cy="690" rx="260" ry="22" fill={SNOW} opacity="0.07" />
    {FLAKES.map(([x, y, r]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={SNOW} opacity="0.55" />
    ))}
  </g>
);

const Glow = ({ ids, y = 520 }: { ids: Ids; y?: number }): ReactElement => (
  <ellipse cx="600" cy={y} rx="560" ry="420" fill={`url(#${ids.glow})`} />
);

const Flame = ({ x, y, scale = 1 }: { x: number; y: number; scale?: number }): ReactElement => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M0 -34 C14 -14 14 4 0 10 C-14 4 -14 -14 0 -34 Z" fill={EMBER} />
    <path d="M0 -26 C9 -12 9 0 0 6 C-9 0 -9 -12 0 -26 Z" fill={SULPHUR} />
    <ellipse cx="0" cy="0" rx="3" ry="6" fill="#fff3c4" />
  </g>
);

const Stove = (): ReactElement => (
  <g transform="translate(600 640)">
    <ellipse cx="0" cy="40" rx="200" ry="26" fill="#000" opacity="0.5" />
    <rect x="-8" y="-370" width="30" height="190" fill="#3a4052" />
    <rect x="-120" y="-390" width="140" height="28" rx="12" fill="#3a4052" />
    <rect x="-130" y="-190" width="260" height="20" rx="6" fill="#232836" />
    <rect x="-120" y="-175" width="240" height="190" rx="22" fill="#3a4052" />
    <rect x="-125" y="-120" width="250" height="12" fill="#d9a73f" />
    <rect x="-125" y="-30" width="250" height="12" fill="#d9a73f" />
    <rect x="-70" y="-100" width="140" height="95" rx="10" fill="#232836" stroke="#d9a73f" strokeWidth="6" />
    <rect x="-46" y="-86" width="92" height="56" rx="6" fill={SULPHUR} />
    <rect x="-46" y="-86" width="92" height="56" rx="6" fill={EMBER} opacity="0.55" />
    <Flame x={0} y={-36} scale={1.1} />
    <circle cx="52" cy="-52" r="6" fill="#d9a73f" />
    <rect x="-24" y="-228" width="48" height="40" rx="8" fill="#d9a73f" />
    <circle cx="0" cy="-246" r="22" fill="#d9a73f" />
    <polygon points="0,-300 -8,-262 8,-262" fill="#d9a73f" />
    {[-100, 100].map((x) => (
      <g key={x}>
        <rect x={x - 10} y="14" width="20" height="26" fill="#d9a73f" />
        <circle cx={x} cy="42" r="14" fill="#d9a73f" />
      </g>
    ))}
    <circle cx="-210" cy="26" r="16" fill="#3d2a22" />
    <circle cx="-180" cy="34" r="16" fill="#4a3228" />
  </g>
);

const Goose = (): ReactElement => (
  <g transform="translate(600 640)">
    <ellipse cx="0" cy="50" rx="330" ry="30" fill="#000" opacity="0.5" />
    <rect x="-300" y="-160" width="600" height="26" fill="#4a3830" />
    <polygon points="-320,-140 320,-140 330,10 -330,10" fill="#e8eef8" />
    {Array.from({ length: 14 }, (_, i) => (
      <rect key={i} x={-310 + i * 44} y="-130" width="18" height="136" fill="#cfd8e8" opacity="0.7" />
    ))}
    <rect x="-290" y="10" width="26" height="60" fill="#4a3830" />
    <rect x="264" y="10" width="26" height="60" fill="#4a3830" />
    <ellipse cx="0" cy="-166" rx="230" ry="22" fill="#dbe5f2" />
    <ellipse cx="0" cy="-232" rx="170" ry="84" fill="#9c551f" />
    <ellipse cx="0" cy="-262" rx="120" ry="48" fill="#c07a30" />
    <ellipse cx="-160" cy="-224" rx="52" ry="34" fill="#8c4a1a" />
    <ellipse cx="160" cy="-224" rx="52" ry="34" fill="#8c4a1a" />
    <rect x="-134" y="-340" width="16" height="64" rx="8" fill="#a65f26" transform="rotate(-24 -126 -310)" />
    <rect x="118" y="-340" width="16" height="64" rx="8" fill="#a65f26" transform="rotate(24 126 -310)" />
    {([[-210, -184, "#a8262e"], [-250, -178, "#3d2549"], [210, -184, "#a8262e"], [248, -178, "#a8262e"], [-70, -182, "#3d2549"], [80, -182, "#a8262e"], [0, -192, "#a8262e"], [-30, -226, "#a8262e"], [34, -222, "#3d2549"]] as const).map(([x, y, fill]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="16" fill={fill} />
    ))}
    <ellipse cx="-270" cy="-152" rx="46" ry="12" fill="#eef3fa" />
    <ellipse cx="270" cy="-152" rx="46" ry="12" fill="#eef3fa" />
    {[-250, 250].map((x) => (
      <g key={x}>
        <rect x={x - 6} y="-330" width="12" height="170" fill="#d9a73f" />
        <rect x={x - 5} y="-380" width="10" height="56" fill="#efe6cf" />
        <Flame x={x} y={-392} scale={0.7} />
      </g>
    ))}
  </g>
);

const Tree = (): ReactElement => (
  <g transform="translate(600 650)">
    <ellipse cx="0" cy="30" rx="230" ry="22" fill="#000" opacity="0.5" />
    <rect x="-14" y="-60" width="28" height="90" fill="#4a3328" />
    {([[-210, 0, 230, "#16473a"], [-190, -150, 190, "#1d5143"], [-160, -270, 140, "#16473a"], [-120, -380, 100, "#1d5143"]] as const).map(([x, y, h, fill], i) => (
      <polygon key={i} points={`0,${y - h} ${x * -1},${y} ${x},${y}`} fill={fill} />
    ))}
    {([[-140, -40], [120, -50], [-90, -190], [70, -200], [-50, -300], [40, -310], [-20, -400], [10, -140]] as const).map(([x, y]) => (
      <g key={`${x}-${y}`}>
        <rect x={x - 3} y={y} width="6" height="20" fill="#efe6cf" />
        <Flame x={x} y={y - 6} scale={0.45} />
      </g>
    ))}
    {([[-90, -90, "#b3262e"], [100, -110, "#c9a23c"], [-30, -240, "#3a5fa8"], [60, -260, "#b3262e"]] as const).map(([x, y, fill]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="11" fill={fill} />
    ))}
    <polygon points="0,-540 10,-512 40,-510 16,-492 24,-462 0,-480 -24,-462 -16,-492 -40,-510 -10,-512" fill={SULPHUR} />
    <rect x="-230" y="-30" width="70" height="56" fill="#7a2a34" />
    <rect x="170" y="-26" width="60" height="52" fill="#2b4a7a" />
  </g>
);

const Star = ({ ids }: { ids: Ids }): ReactElement => (
  <g>
    <polygon points="760,250 232,40 252,92" fill={`url(#${ids.streak})`} />
    <polygon points="740,290 330,120 340,160" fill={`url(#${ids.streak})`} opacity="0.7" />
    <circle cx="780" cy="270" r="130" fill={`url(#${ids.halo})`} />
    <polygon points="780,200 800,254 858,256 812,290 830,346 780,312 730,346 748,290 702,256 760,254" fill="#fff4c4" />
    {([[480, 130, 5], [560, 170, 4], [400, 100, 3], [650, 215, 6]] as const).map(([x, y, r]) => (
      <circle key={x} cx={x} cy={y} r={r} fill="#fff4c4" opacity="0.8" />
    ))}
  </g>
);

const Grandmother = ({ ids }: { ids: Ids }): ReactElement => (
  <g transform="translate(600 650)">
    <circle cx="0" cy="-330" r="300" fill={`url(#${ids.halo})`} />
    <ellipse cx="0" cy="30" rx="220" ry="22" fill="#000" opacity="0.5" />
    <path d="M-20 -330 L-120 -230 L-230 20 L230 20 L120 -230 L20 -330 Z" fill="#e3dcef" />
    <path d="M-110 -250 L0 -190 L110 -250 L90 -300 L-90 -300 Z" fill="#a8b6dc" />
    <rect x="-52" y="-200" width="104" height="190" fill="#f6f1e6" />
    <path d="M-100 -260 L-170 -120 L-130 -100 L-60 -200 Z" fill="#cfc8e0" />
    <path d="M100 -260 L170 -120 L130 -100 L60 -200 Z" fill="#cfc8e0" />
    <circle cx="0" cy="-390" r="46" fill="#efdcc9" />
    <path d="M-52 -394 C-56 -450 56 -450 52 -394 C40 -420 -40 -420 -52 -394 Z" fill="#eef1f8" />
    <circle cx="0" cy="-452" r="24" fill="#eef1f8" />
    <circle cx="-16" cy="-388" r="4" fill="#2a2430" />
    <circle cx="16" cy="-388" r="4" fill="#2a2430" />
    <path d="M-12 -366 Q0 -356 12 -366" stroke="#a85a58" strokeWidth="3" fill="none" />
    {Array.from({ length: 12 }, (_, i) => {
      const spread = ((i - 5.5) / 5.5) * 0.5;
      const tipX = Math.sin(spread) * 120;
      const tipY = -170 - Math.cos(spread) * 120;
      return (
        <g key={i}>
          <line x1="0" y1="-170" x2={tipX} y2={tipY} stroke="#e4d9bb" strokeWidth="4" />
          <Flame x={tipX} y={tipY - 10} scale={0.5} />
        </g>
      );
    })}
  </g>
);

const Shelf = (): ReactElement => (
  <g>
    <rect width="1200" height="800" fill="#080e1a" />
    {Array.from({ length: 12 }, (_, row) =>
      Array.from({ length: 20 }, (_, column) => {
        const index = row * 20 + column;
        return (
          <g key={index}>
            <rect x={40 + column * 56} y={60 + row * 56} width="48" height="48" fill="#1c2a47" />
            <rect x={40 + column * 56} y={60 + row * 56} width="48" height="16" fill="#43557f" />
            {index % 7 === 3 ? <polygon points={`${88 + column * 56},${60 + row * 56} ${64 + column * 56},${60 + row * 56} ${88 + column * 56},${84 + row * 56}`} fill="#080e1a" /> : null}
          </g>
        );
      }),
    )}
  </g>
);

const visionOf = (chapter: Chapter, ids: Ids): ReactNode => {
  switch (chapter) {
    case "stove":
      return <Stove />;
    case "goose":
      return <Goose />;
    case "tree":
      return <Tree />;
    case "star":
      return <Star ids={ids} />;
    case "grandmother":
      return <Grandmother ids={ids} />;
    default:
      return null;
  }
};

/**
 * The illustrated chapter drawn when WebGL is not available: the snowbound alley, and when `lit` the chapter's
 * vision in the warm light of the match. Decoration only; the caption and controls live in the page.
 */
export const StillChapter = ({ chapter, lit }: { chapter: Chapter; lit: boolean }): ReactElement => {
  const prefix = useId();
  const ids: Ids = {
    sky: `${prefix}-sky`,
    snow: `${prefix}-snow`,
    glow: `${prefix}-glow`,
    streak: `${prefix}-streak`,
    halo: `${prefix}-halo`,
  };
  return (
    <svg
      role="img"
      aria-label={CHAPTER_TITLES[chapter]}
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      style={{ display: "block", background: GROUND }}
    >
      <defs>
        <linearGradient id={ids.sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#04070e" />
          <stop offset="1" stopColor="#0f1b30" />
        </linearGradient>
        <linearGradient id={ids.snow} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c2a44" />
          <stop offset="1" stopColor="#3b4d70" />
        </linearGradient>
        <radialGradient id={ids.glow}>
          <stop offset="0" stopColor={SULPHUR} stopOpacity="0.5" />
          <stop offset="0.45" stopColor={EMBER} stopOpacity="0.18" />
          <stop offset="1" stopColor={EMBER} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ids.halo}>
          <stop offset="0" stopColor="#fff4c4" stopOpacity="0.85" />
          <stop offset="1" stopColor={SULPHUR} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ids.streak} x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#fff4c4" />
          <stop offset="1" stopColor="#fff4c4" stopOpacity="0" />
        </linearGradient>
      </defs>
      {chapter === "shelf" ? <Shelf /> : <Alley ids={ids} />}
      {lit && chapter !== "shelf" ? (
        <g>
          {chapter === "star" ? null : <Glow ids={ids} />}
          {visionOf(chapter, ids)}
        </g>
      ) : null}
    </svg>
  );
};
