import { svg } from "./dom.js";

/**
 * Each portrait is a procedural drawing of a generic object on its own flat
 * ground, sampled from its dial or leatherette. No real maker or model name
 * ever appears.
 */
const grounds: Record<string, string> = {
  chronograph: "#5c1a1f",
  rangefinder: "#17402c",
  diver: "#2c3d55",
  twin_lens: "#4a3421",
  dress: "#36332f",
  bellows: "#6b4e12",
};

const order = ["chronograph", "rangefinder", "diver", "twin_lens", "dress", "bellows"];

/** groundOf is the flat colour a portrait sits on. */
export const groundOf = (portrait: string | null): string =>
  grounds[portrait ?? ""] ?? grounds[order[0]];

const dialFace = (ground: string, extra: string): string => `
  <rect width="200" height="300" fill="${ground}"/>
  <rect x="94" y="18" width="12" height="26" rx="3" fill="#cfc8bf"/>
  <rect x="88" y="256" width="24" height="30" rx="4" fill="#b8b1a8"/>
  <path d="M70 46 L130 46 L128 70 L72 70 Z" fill="#9d968d"/>
  <path d="M70 254 L130 254 L128 230 L72 230 Z" fill="#9d968d"/>
  <circle cx="100" cy="150" r="78" fill="#d8d2c9"/>
  <circle cx="100" cy="150" r="70" fill="#1b1917"/>
  ${extra}
  <circle cx="100" cy="150" r="4" fill="#d8d2c9"/>`;

const ticks = (count: number, inner: number, outer: number, width: number): string => {
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const x1 = 100 + Math.sin(angle) * inner;
    const y1 = 150 - Math.cos(angle) * inner;
    const x2 = 100 + Math.sin(angle) * outer;
    const y2 = 150 - Math.cos(angle) * outer;
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e7e2da" stroke-width="${width}"/>`;
  }
  return out;
};

const drawings: Record<string, (ground: string) => string> = {
  chronograph: (ground) =>
    dialFace(
      ground,
      `${ticks(60, 62, 68, 1)}${ticks(12, 54, 68, 3)}
       <circle cx="100" cy="104" r="20" fill="none" stroke="#8d867d" stroke-width="2"/>
       <circle cx="66" cy="168" r="20" fill="none" stroke="#8d867d" stroke-width="2"/>
       <circle cx="134" cy="168" r="20" fill="none" stroke="#8d867d" stroke-width="2"/>
       <line x1="100" y1="150" x2="100" y2="96" stroke="#f2eee8" stroke-width="4"/>
       <line x1="100" y1="150" x2="140" y2="174" stroke="#f2eee8" stroke-width="4"/>
       <line x1="100" y1="150" x2="78" y2="206" stroke="#c9a227" stroke-width="2"/>`,
    ),
  diver: (ground) =>
    `<rect width="200" height="300" fill="${ground}"/>
     <rect x="88" y="20" width="24" height="26" rx="4" fill="#c3bcb2"/>
     <rect x="88" y="254" width="24" height="26" rx="4" fill="#c3bcb2"/>
     <rect x="60" y="54" width="80" height="20" rx="6" fill="#a9a29a"/>
     <rect x="60" y="226" width="80" height="20" rx="6" fill="#a9a29a"/>
     <circle cx="100" cy="150" r="82" fill="#cdc6bd"/>
     <circle cx="100" cy="150" r="74" fill="#101826"/>
     <circle cx="100" cy="150" r="60" fill="#182434"/>
     ${ticks(12, 64, 72, 5)}
     <circle cx="100" cy="86" r="7" fill="#c9a227"/>
     ${ticks(12, 44, 54, 3)}
     <line x1="100" y1="150" x2="100" y2="104" stroke="#eae5dd" stroke-width="6"/>
     <line x1="100" y1="150" x2="134" y2="170" stroke="#eae5dd" stroke-width="5"/>
     <rect x="176" y="140" width="12" height="20" rx="3" fill="#b4ada4"/>`,
  dress: (ground) =>
    dialFace(
      ground,
      `<circle cx="100" cy="150" r="62" fill="#efe9df"/>
       ${ticks(12, 48, 56, 2)}
       <line x1="100" y1="150" x2="100" y2="110" stroke="#2a2724" stroke-width="3"/>
       <line x1="100" y1="150" x2="128" y2="162" stroke="#2a2724" stroke-width="3"/>
       <circle cx="100" cy="150" r="3" fill="#2a2724"/>`,
    ),
  rangefinder: (ground) =>
    `<rect width="200" height="300" fill="${ground}"/>
     <rect x="20" y="96" width="160" height="108" rx="8" fill="#201d1a"/>
     <rect x="20" y="118" width="160" height="64" fill="#3a352f"/>
     <rect x="28" y="80" width="54" height="22" rx="4" fill="#2a2621"/>
     <rect x="120" y="80" width="30" height="18" rx="3" fill="#2a2621"/>
     <circle cx="100" cy="150" r="42" fill="#15130f"/>
     <circle cx="100" cy="150" r="34" fill="#c9c2b8"/>
     <circle cx="100" cy="150" r="26" fill="#1d1b18"/>
     <circle cx="100" cy="150" r="14" fill="#4a5a66"/>
     <circle cx="93" cy="143" r="5" fill="#cfe0ea" opacity="0.7"/>
     <circle cx="44" cy="92" r="9" fill="#d6cfc5"/>
     <circle cx="156" cy="92" r="9" fill="#d6cfc5"/>
     <rect x="150" y="70" width="22" height="12" rx="3" fill="#d6cfc5"/>`,
  twin_lens: (ground) =>
    `<rect width="200" height="300" fill="${ground}"/>
     <rect x="42" y="56" width="116" height="196" rx="8" fill="#211d19"/>
     <rect x="42" y="56" width="116" height="52" rx="8" fill="#302a24"/>
     <rect x="54" y="30" width="92" height="30" rx="5" fill="#2a2520"/>
     <circle cx="100" cy="104" r="28" fill="#15130f"/>
     <circle cx="100" cy="104" r="21" fill="#c6bfb5"/>
     <circle cx="100" cy="104" r="14" fill="#1b1916"/>
     <circle cx="100" cy="180" r="38" fill="#15130f"/>
     <circle cx="100" cy="180" r="30" fill="#c6bfb5"/>
     <circle cx="100" cy="180" r="22" fill="#1b1916"/>
     <circle cx="100" cy="180" r="11" fill="#45525c"/>
     <circle cx="92" cy="172" r="4" fill="#d3e2ec" opacity="0.7"/>
     <rect x="52" y="226" width="28" height="14" rx="3" fill="#b9b2a8"/>
     <rect x="120" y="226" width="28" height="14" rx="3" fill="#b9b2a8"/>`,
  bellows: (ground) =>
    `<rect width="200" height="300" fill="${ground}"/>
     <rect x="30" y="178" width="140" height="92" rx="6" fill="#241f18"/>
     <rect x="30" y="178" width="140" height="18" fill="#332c22"/>
     <path d="M62 178 L138 178 L126 92 L74 92 Z" fill="#2c261e"/>
     ${[0, 1, 2, 3, 4, 5]
       .map((i) => {
         const t = i / 5;
         const y = 178 - t * 86;
         const halfWidth = 38 - t * 6;
         return `<line x1="${100 - halfWidth}" y1="${y.toFixed(0)}" x2="${100 + halfWidth}" y2="${y.toFixed(0)}" stroke="#4a4136" stroke-width="3"/>`;
       })
       .join("")}
     <rect x="70" y="72" width="60" height="24" rx="4" fill="#191713"/>
     <circle cx="100" cy="84" r="16" fill="#cdc6bc"/>
     <circle cx="100" cy="84" r="10" fill="#1a1815"/>
     <circle cx="96" cy="80" r="3" fill="#dfe8ee" opacity="0.7"/>
     <rect x="44" y="246" width="34" height="12" rx="3" fill="#b3aca2"/>
     <circle cx="146" cy="252" r="9" fill="#b3aca2"/>`,
};

/** portrait draws one lot's procedural portrait. */
export const portrait = (
  kind: string | null,
  label: string | null,
  cls = "portrait",
): SVGSVGElement => {
  const key = kind && drawings[kind] ? kind : order[0];
  return svg(drawings[key](grounds[key]), label, cls);
};
