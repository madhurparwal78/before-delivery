// The six lot portraits, drawn as the real objects on their own flat ground (2:3).
import type { ComponentChildren } from "preact";

const GROUNDS: Record<string, string> = {
  chronograph: "#6E1F2A",
  rangefinder: "#1E4D36",
  diver: "#3F5973",
  twin_lens: "#6B4628",
  dress: "#3E4044",
  bellows: "#B58A2E",
};

const CREAM = "#EFE6D2";
const STEEL = "#C9CCCF";
const STEEL_DARK = "#8D9296";
const BLACK = "#14110E";
const BRASS = "#D8B25A";

function ticks(cx: number, cy: number, inner: number, outer: number, count: number, stroke: string, width: number, every = 1) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const long = i % every === 0;
    const r1 = long ? inner : inner + (outer - inner) * 0.4;
    return (
      <line
        key={i}
        x1={cx + Math.sin(a) * r1}
        y1={cy - Math.cos(a) * r1}
        x2={cx + Math.sin(a) * outer}
        y2={cy - Math.cos(a) * outer}
        stroke={stroke}
        stroke-width={long ? width : width * 0.6}
      />
    );
  });
}

function hand(cx: number, cy: number, angle: number, length: number, width: number, fill: string, tail = 10) {
  return (
    <g transform={`rotate(${angle} ${cx} ${cy})`}>
      <polygon points={`${cx - width},${cy + tail} ${cx},${cy - length} ${cx + width},${cy + tail}`} fill={fill} />
    </g>
  );
}

function Chronograph() {
  const cx = 100, cy = 150;
  return (
    <g>
      <rect x="80" y="0" width="40" height="70" fill={BLACK} />
      <rect x="80" y="230" width="40" height="70" fill={BLACK} />
      <rect x="168" y="138" width="14" height="24" rx="2" fill={STEEL} />
      <rect x="150" y="96" width="12" height="18" rx="2" fill={STEEL} transform="rotate(30 156 105)" />
      <rect x="150" y="186" width="12" height="18" rx="2" fill={STEEL} transform="rotate(-30 156 195)" />
      <circle cx={cx} cy={cy} r="74" fill={STEEL} />
      <circle cx={cx} cy={cy} r="68" fill={STEEL_DARK} />
      <circle cx={cx} cy={cy} r="62" fill={BLACK} />
      {ticks(cx, cy, 52, 60, 60, CREAM, 1.6, 5)}
      {[[-26, -6, 14], [26, -6, 14], [0, 30, 14]].map(([dx, dy, r], i) => (
        <g key={i}>
          <circle cx={cx + (dx ?? 0)} cy={cy + (dy ?? 0)} r={r} fill="#241d18" stroke={CREAM} stroke-width="1" />
          {ticks(cx + (dx ?? 0), cy + (dy ?? 0), (r ?? 14) - 5, (r ?? 14) - 1, 12, CREAM, 1)}
          {hand(cx + (dx ?? 0), cy + (dy ?? 0), 40 + i * 70, (r ?? 14) - 4, 1, CREAM, 2)}
        </g>
      ))}
      <rect x={cx - 15} y={cy - 43} width="30" height="1.6" fill={CREAM} />
      {hand(cx, cy, 300, 38, 2.4, CREAM, 12)}
      {hand(cx, cy, 70, 52, 1.8, CREAM, 12)}
      <line x1={cx} y1={cy + 14} x2={cx} y2={cy - 56} stroke={BRASS} stroke-width="1" transform={`rotate(150 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r="3.5" fill={BRASS} />
    </g>
  );
}

function Rangefinder() {
  return (
    <g>
      <rect x="22" y="92" width="156" height="128" rx="6" fill="#16120F" />
      <rect x="22" y="92" width="156" height="128" rx="6" fill="none" stroke="#0a0806" stroke-width="2" />
      {Array.from({ length: 11 }, (_, r) =>
        Array.from({ length: 14 }, (_, c) => <circle key={`${r}-${c}`} cx={32 + c * 10.5 + (r % 2) * 3} cy={104 + r * 10.5} r="0.9" fill="#2c2620" />),
      )}
      <rect x="14" y="62" width="172" height="40" rx="5" fill={STEEL} />
      <rect x="14" y="62" width="172" height="12" rx="5" fill="#E4E6E7" />
      <rect x="30" y="72" width="28" height="22" rx="3" fill={BLACK} stroke={STEEL_DARK} stroke-width="1.5" />
      <rect x="64" y="72" width="22" height="22" rx="3" fill="#2a3b44" stroke={STEEL_DARK} stroke-width="1.5" />
      <rect x="68" y="76" width="14" height="14" rx="1" fill="#5d7f90" opacity="0.7" />
      <circle cx="152" cy="68" r="8" fill={BRASS} stroke={STEEL_DARK} stroke-width="1.5" />
      <rect x="120" y="48" width="14" height="16" rx="2" fill={STEEL} />
      <circle cx="100" cy="162" r="48" fill={STEEL} />
      <circle cx="100" cy="162" r="40" fill={STEEL_DARK} />
      <circle cx="100" cy="162" r="34" fill={BLACK} />
      <circle cx="100" cy="162" r="26" fill="#20303a" />
      <circle cx="100" cy="162" r="14" fill="#0d1a21" />
      <path d="M84 146 A22 22 0 0 1 104 140" stroke="#cfe3ea" stroke-width="3" fill="none" opacity="0.6" stroke-linecap="round" />
      {ticks(100, 162, 36, 40, 36, CREAM, 1, 3)}
    </g>
  );
}

function Diver() {
  const cx = 100, cy = 150;
  return (
    <g>
      <rect x="76" y="0" width="48" height="76" fill={BLACK} />
      <rect x="76" y="224" width="48" height="76" fill={BLACK} />
      <circle cx={cx} cy={cy} r="82" fill={STEEL_DARK} />
      <circle cx={cx} cy={cy} r="78" fill="#15191d" />
      {ticks(cx, cy, 66, 77, 60, CREAM, 2.4, 5)}
      <circle cx={cx} cy={cy - 71} r="4" fill="#9fe6b2" />
      <circle cx={cx} cy={cy} r="62" fill={STEEL} />
      <circle cx={cx} cy={cy} r="58" fill="#0f1f2c" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const big = i % 3 === 0;
        return big ? (
          <rect key={i} x={cx + Math.sin(a) * 46 - 5} y={cy - Math.cos(a) * 46 - 5} width="10" height="10" rx="2" fill={CREAM} />
        ) : (
          <circle key={i} cx={cx + Math.sin(a) * 46} cy={cy - Math.cos(a) * 46} r="3.4" fill={CREAM} />
        );
      })}
      <rect x="124" y="143" width="18" height="14" rx="1" fill={CREAM} />
      <rect x="128.5" y="146" width="2.4" height="8" fill={BLACK} />
      <rect x="133.5" y="146" width="4" height="8" fill={BLACK} />
      {hand(cx, cy, 305, 32, 3.4, CREAM, 12)}
      {hand(cx, cy, 65, 46, 2.6, CREAM, 12)}
      <line x1={cx} y1={cy + 18} x2={cx} y2={cy - 52} stroke="#e0613c" stroke-width="1.2" transform={`rotate(200 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r="4" fill={CREAM} />
    </g>
  );
}

function TwinLens() {
  return (
    <g>
      <rect x="46" y="22" width="108" height="30" rx="3" fill="#1b1612" />
      <rect x="54" y="30" width="92" height="22" fill="#2c2620" />
      <rect x="30" y="52" width="140" height="210" rx="10" fill="#17120e" />
      <rect x="30" y="52" width="140" height="210" rx="10" fill="none" stroke="#0a0806" stroke-width="2" />
      {Array.from({ length: 14 }, (_, r) =>
        Array.from({ length: 11 }, (_, c) => <circle key={`${r}-${c}`} cx={42 + c * 12.4} cy={64 + r * 13.6} r="1" fill="#2c2620" />),
      )}
      <rect x="22" y="70" width="156" height="20" rx="3" fill={STEEL} />
      <circle cx="100" cy="124" r="40" fill={STEEL} />
      <circle cx="100" cy="124" r="33" fill={BLACK} />
      <circle cx="100" cy="124" r="25" fill="#1d2a31" />
      <circle cx="100" cy="124" r="12" fill="#0b1317" />
      <path d="M84 110 A20 20 0 0 1 102 104" stroke="#cfe3ea" stroke-width="2.5" fill="none" opacity="0.6" stroke-linecap="round" />
      <circle cx="100" cy="212" r="40" fill={STEEL} />
      <circle cx="100" cy="212" r="33" fill={BLACK} />
      <circle cx="100" cy="212" r="25" fill="#1d2a31" />
      <circle cx="100" cy="212" r="12" fill="#0b1317" />
      <path d="M84 198 A20 20 0 0 1 102 192" stroke="#cfe3ea" stroke-width="2.5" fill="none" opacity="0.6" stroke-linecap="round" />
      <circle cx="178" cy="160" r="9" fill={BRASS} stroke={STEEL_DARK} stroke-width="1.5" />
      <rect x="176" y="160" width="14" height="4" fill={BRASS} />
      <circle cx="26" cy="64" r="5" fill={STEEL_DARK} />
      <circle cx="174" cy="64" r="5" fill={STEEL_DARK} />
    </g>
  );
}

function Dress() {
  const cx = 100, cy = 150;
  return (
    <g>
      <rect x="84" y="0" width="32" height="84" fill="#2a1f17" />
      <rect x="84" y="216" width="32" height="84" fill="#2a1f17" />
      {Array.from({ length: 6 }, (_, i) => <circle key={i} cx="100" cy={20 + i * 10} r="0.9" fill="#a68f73" />)}
      <circle cx={cx} cy={cy} r="68" fill="#d6c58b" />
      <circle cx={cx} cy={cy} r="64" fill="#b9a56b" />
      <circle cx={cx} cy={cy} r="58" fill="#f3ecda" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const quarter = i % 3 === 0;
        const r1 = quarter ? 44 : 48;
        return (
          <line key={i} x1={cx + Math.sin(a) * r1} y1={cy - Math.cos(a) * r1} x2={cx + Math.sin(a) * 54} y2={cy - Math.cos(a) * 54} stroke="#2a251e" stroke-width={quarter ? 3 : 1.6} />
        );
      })}
      <circle cx={cx} cy={cy + 28} r="13" fill="none" stroke="#9a8d70" stroke-width="1" />
      {hand(cx, cy + 28, 120, 9, 0.9, "#2a251e", 2)}
      <rect x={cx - 14} y={cy - 24} width="28" height="1.4" fill="#2a251e" />
      {hand(cx, cy, 320, 34, 2.4, "#2a251e", 10)}
      {hand(cx, cy, 75, 48, 1.8, "#2a251e", 10)}
      <circle cx={cx} cy={cy} r="3" fill="#2a251e" />
      <rect x="166" y="143" width="10" height="14" rx="2" fill="#d6c58b" />
    </g>
  );
}

function Bellows() {
  return (
    <g>
      <rect x="20" y="226" width="160" height="26" rx="3" fill="#2a1f17" />
      <rect x="20" y="226" width="160" height="6" fill="#4a382a" />
      <rect x="62" y="84" width="76" height="76" rx="4" fill="#17120e" />
      <circle cx="100" cy="122" r="26" fill={STEEL} />
      <circle cx="100" cy="122" r="20" fill={BLACK} />
      <circle cx="100" cy="122" r="12" fill="#1d2a31" />
      <circle cx="100" cy="122" r="5" fill="#0b1317" />
      <path d="M90 112 A14 14 0 0 1 102 108" stroke="#cfe3ea" stroke-width="2" fill="none" opacity="0.6" stroke-linecap="round" />
      <polygon points="62,160 138,160 168,226 32,226" fill="#241c16" />
      {Array.from({ length: 7 }, (_, i) => {
        const t = (i + 1) / 8;
        const y = 160 + t * 66;
        const half = 38 + t * 52;
        return <line key={i} x1={100 - half} y1={y} x2={100 + half} y2={y} stroke="#4a382a" stroke-width="2.4" />;
      })}
      <line x1="62" y1="160" x2="32" y2="226" stroke="#4a382a" stroke-width="2" />
      <line x1="138" y1="160" x2="168" y2="226" stroke="#4a382a" stroke-width="2" />
      <rect x="40" y="84" width="22" height="64" rx="3" fill={STEEL} />
      <rect x="138" y="84" width="22" height="64" rx="3" fill={STEEL} />
      <circle cx="150" cy="76" r="7" fill={BRASS} />
      <rect x="86" y="236" width="28" height="8" rx="2" fill={STEEL_DARK} />
    </g>
  );
}

const DRAWINGS: Record<string, () => ComponentChildren> = {
  chronograph: Chronograph,
  rangefinder: Rangefinder,
  diver: Diver,
  twin_lens: TwinLens,
  dress: Dress,
  bellows: Bellows,
};

interface PortraitProps {
  kind: string | null;
  label?: string;
}

/** Portrait draws one lot's object on its flat ground; with a label it is an image, without it is decoration. */
export function Portrait({ kind, label }: PortraitProps) {
  const key = kind && DRAWINGS[kind] ? kind : "chronograph";
  const Drawing = DRAWINGS[key] as () => ComponentChildren;
  return (
    <svg
      class="portrait"
      viewBox="0 0 200 300"
      preserveAspectRatio="xMidYMid slice"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
    >
      <rect width="200" height="300" fill={GROUNDS[key]} />
      <Drawing />
    </svg>
  );
}
