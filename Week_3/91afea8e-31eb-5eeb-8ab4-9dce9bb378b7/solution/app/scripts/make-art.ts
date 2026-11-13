/**
 * Procedural product art: original flat vector SVGs written to public/art.
 * Run once: node --experimental-strip-types scripts/make-art.ts
 * Every file is a square 400 x 400 drawing on a transparent background.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "art");

const C = {
  steelMid: "#aeb6c4",
  steelLight: "#eef1f6",
  steelDark: "#6c7589",
  black: "#07070f",
  yellow: "#ffd60a",
  pink: "#ff2d95",
  accent: "#00e58a",
  accentDeep: "#00a862",
  ultra: "#1f2fff",
  slate: "#2c3170",
  slateLight: "#4a52a3",
  slateDeep: "#181c4d",
  yellowDeep: "#d9a900",
};

type Drawing = { name: string; body: string };

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" fill="none">${body}</svg>\n`;

const rect = (x: number, y: number, w: number, h: number, r: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const circle = (cx: number, cy: number, r: number, fill: string): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const path = (d: string, fill: string): string => `<path d="${d}" fill="${fill}"/>`;
const stroke = (d: string, color: string, width: number): string =>
  `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A steel part: mid base, a darker right facet and one light highlight band. */
function steel(id: string, shape: (fill: string) => string, clip: string, x: number, w: number, y: number, h: number): string {
  return [
    `<defs><clipPath id="${id}">${clip}</clipPath></defs>`,
    shape(C.steelMid),
    `<g clip-path="url(#${id})">`,
    rect(x + w * 0.58, y, w * 0.42, h, 0, C.steelDark),
    rect(x + w * 0.16, y, w * 0.1, h, 0, C.steelLight),
    `</g>`,
  ].join("");
}

function steelRect(id: string, x: number, y: number, w: number, h: number, r: number): string {
  return steel(id, (fill) => rect(x, y, w, h, r, fill), `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`, x, w, y, h);
}

function tiffin(): string {
  const tier = (id: string, y: number): string =>
    steelRect(id, 105, y, 190, 62, 14) + rect(100, y + 22, 200, 8, 4, C.steelLight) + rect(100, y + 30, 200, 6, 3, C.steelDark);
  return [
    stroke("M104 336 V150 Q104 78 152 70 H248 Q296 78 296 150 V336", C.steelDark, 9),
    stroke("M104 336 V150 Q104 78 152 70 H248 Q296 78 296 150 V336", C.steelMid, 4),
    rect(130, 56, 140, 22, 11, C.yellow),
    rect(150, 60, 100, 6, 3, C.yellowDeep),
    tier("tiffin-base", 272),
    tier("tiffin-mid", 204),
    tier("tiffin-top", 136),
    steel("tiffin-lid", (fill) => path("M105 138 Q105 92 200 92 Q295 92 295 138 Z", fill), `<path d="M105 138 Q105 92 200 92 Q295 92 295 138 Z"/>`, 105, 190, 92, 46),
    circle(200, 86, 12, C.yellow),
    rect(196, 330, 8, 20, 4, C.steelDark),
    rect(150, 340, 100, 16, 8, C.steelDark),
    rect(150, 340, 100, 5, 2.5, C.steelLight),
  ].join("");
}

function cooker(): string {
  const bodyPath = "M82 214 H318 V300 Q318 346 272 346 H128 Q82 346 82 300 Z";
  const lidPath = "M70 214 Q72 168 200 164 Q328 168 330 214 Z";
  return [
    rect(26, 238, 62, 26, 13, C.black),
    rect(34, 244, 46, 6, 3, C.slateLight),
    rect(312, 244, 42, 20, 10, C.black),
    steel("cooker-body", (fill) => path(bodyPath, fill), `<path d="${bodyPath}"/>`, 82, 236, 214, 132),
    rect(78, 208, 244, 14, 7, C.steelDark),
    rect(78, 208, 244, 5, 2.5, C.steelLight),
    steel("cooker-lid", (fill) => path(lidPath, fill), `<path d="${lidPath}"/>`, 70, 260, 164, 50),
    rect(140, 150, 120, 20, 10, C.black),
    rect(150, 154, 100, 5, 2.5, C.slateLight),
    rect(184, 108, 32, 48, 8, C.slate),
    rect(176, 96, 48, 18, 9, C.yellow),
    circle(256, 188, 9, C.pink),
    rect(120, 270, 70, 10, 5, C.steelLight),
  ].join("");
}

function bottle(): string {
  const bodyPath = "M138 168 Q138 150 160 140 L176 128 H224 L240 140 Q262 150 262 168 V336 Q262 356 242 356 H158 Q138 356 138 336 Z";
  const dimples = [
    [172, 200], [210, 214], [238, 196], [186, 250], [226, 268], [166, 296], [206, 312], [240, 320],
  ] as const;
  return [
    rect(168, 52, 64, 26, 10, C.yellow),
    rect(168, 52, 64, 8, 4, C.yellowDeep),
    rect(176, 78, 48, 56, 6, C.steelMid),
    rect(206, 78, 18, 56, 4, C.steelDark),
    rect(180, 78, 6, 56, 3, C.steelLight),
    steel("bottle-body", (fill) => path(bodyPath, fill), `<path d="${bodyPath}"/>`, 138, 124, 128, 228),
    rect(138, 214, 124, 30, 0, C.pink),
    rect(138, 214, 124, 6, 0, C.black),
    rect(138, 238, 124, 6, 0, C.black),
    ...dimples.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="9" ry="6" fill="${C.steelDark}" opacity="0.55"/>`),
  ].join("");
}

function saree(): string {
  const cloth = "M104 64 Q200 40 296 64 L326 350 Q200 384 74 350 Z";
  const diamonds = [118, 148, 178, 208, 238, 268]
    .map((x) => path(`M${x} 336 l10 -10 l10 10 l-10 10 Z`, C.pink))
    .join("");
  const border = "M72 322 Q200 356 328 322 L326 352 Q200 386 74 352 Z";
  const pleats = [150, 176, 202, 228, 254]
    .map((x, i) => stroke(`M${x} 210 Q${x + 6} 270 ${x - 4 + i} 330`, C.accentDeep, 10))
    .join("");
  return [
    path(cloth, C.accent),
    pleats,
    path("M104 64 L204 52 L334 238 L268 286 Z", C.accentDeep),
    path("M104 64 L204 52 L226 84 L124 98 Z", C.yellow),
    stroke("M126 110 L240 262", C.yellow, 10),
    stroke("M150 124 L262 270", C.black, 4),
    path(border, C.black),
    path("M72 332 Q200 366 328 332 L327 344 Q200 378 73 344 Z", C.yellow),
    diamonds,
    path("M74 80 L104 64 L74 350 L56 340 Z", C.black),
    path("M56 340 L74 350 L104 64 L98 62 Z", C.yellow),
  ].join("");
}

function kurta(): string {
  const body = "M152 58 Q200 92 248 58 L328 88 L376 206 L324 224 L302 176 V354 H98 V176 L76 224 L24 206 L72 88 Z";
  const yoke = [150, 168, 186, 204, 222, 240]
    .map((x) => path(`M${x} 116 l8 -8 l8 8 l-8 8 Z`, x % 36 === 0 ? C.pink : C.black))
    .join("");
  return [
    path(body, C.yellow),
    path("M302 176 L324 224 L376 206 L328 88 L302 120 Z", C.yellowDeep),
    path("M152 58 Q200 92 248 58 L240 52 Q200 78 160 52 Z", C.black),
    rect(192, 78, 16, 150, 4, C.yellowDeep),
    circle(200, 112, 5, C.black),
    circle(200, 150, 5, C.black),
    circle(200, 188, 5, C.black),
    yoke,
    path("M120 150 q10 -10 20 0 q-10 10 -20 0 Z", C.pink),
    path("M260 150 q10 -10 20 0 q-10 10 -20 0 Z", C.pink),
    rect(98, 322, 204, 32, 0, C.black),
    [118, 146, 174, 202, 230, 258].map((x) => circle(x + 10, 338, 6, C.pink)).join(""),
    rect(198, 300, 4, 22, 2, C.yellowDeep),
  ].join("");
}

function speaker(): string {
  return [
    stroke("M160 76 V52 Q160 42 170 42 H230 Q240 42 240 52 V76", C.yellow, 9),
    rect(86, 70, 228, 292, 44, C.slate),
    rect(86, 70, 78, 292, 44, C.slateLight),
    rect(130, 70, 34, 292, 0, C.slateLight),
    rect(164, 70, 150, 292, 0, C.slate),
    rect(270, 70, 44, 292, 0, C.slateDeep),
    circle(200, 134, 30, C.slateDeep),
    circle(200, 134, 20, C.slateLight),
    circle(200, 134, 8, C.yellow),
    circle(200, 244, 88, C.yellow),
    circle(200, 244, 78, C.black),
    circle(200, 244, 66, C.slateLight),
    circle(200, 244, 52, C.slateDeep),
    circle(200, 244, 38, C.slate),
    circle(200, 244, 22, C.slateDeep),
    circle(200, 244, 10, C.yellow),
    stroke("M148 216 A64 64 0 0 1 186 182", C.steelLight, 6),
    circle(124, 336, 11, C.pink),
    circle(160, 336, 11, C.yellow),
    circle(200, 336, 11, C.accent),
  ].join("");
}

function watch(): string {
  const dots = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    .map((i) => {
      const a = (i * Math.PI) / 6;
      const x = 200 + Math.sin(a) * 66;
      const y = 200 - Math.cos(a) * 66;
      return circle(Number(x.toFixed(1)), Number(y.toFixed(1)), i % 3 === 0 ? 5 : 3, i % 3 === 0 ? C.yellow : C.steelMid);
    })
    .join("");
  return [
    path("M148 130 L156 40 Q158 24 176 24 H224 Q242 24 244 40 L252 130 Z", C.slate),
    path("M148 270 L156 360 Q158 376 176 376 H224 Q242 376 244 360 L252 270 Z", C.slate),
    path("M148 270 L156 360 Q158 376 176 376 H190 L184 270 Z", C.slateLight),
    path("M148 130 L156 40 Q158 24 176 24 H190 L184 130 Z", C.slateLight),
    circle(200, 340, 6, C.slateDeep),
    circle(200, 322, 6, C.slateDeep),
    circle(200, 304, 6, C.slateDeep),
    rect(256, 176, 22, 48, 8, C.yellow),
    rect(112, 112, 176, 176, 52, C.slateDeep),
    rect(122, 122, 156, 156, 44, C.black),
    dots,
    stroke("M200 200 V150", C.steelLight, 7),
    stroke("M200 200 L236 218", C.pink, 6),
    circle(200, 200, 8, C.accent),
    stroke("M132 162 A72 72 0 0 1 162 130", C.accent, 6),
  ].join("");
}

function earbuds(): string {
  const bud = (cx: number, flip: number): string => {
    const tilt = flip * 16;
    return [
      `<g transform="rotate(${tilt} ${cx} 168)">`,
      rect(cx - 11, 190, 22, 78, 11, C.steelMid),
      rect(cx + (flip > 0 ? 0 : -11), 190, 11, 78, 5.5, C.steelDark),
      circle(cx, 164, 44, C.steelLight),
      path(`M${cx - 44} 164 A44 44 0 0 0 ${cx + 44} 164 Z`, C.steelMid),
      `<ellipse cx="${cx - flip * 12}" cy="152" rx="13" ry="9" fill="${C.slateDeep}"/>`,
      circle(cx + flip * 20, 182, 5, C.pink),
      `</g>`,
    ].join("");
  };
  return [
    path("M66 246 V196 Q66 112 200 112 Q334 112 334 196 V246 Z", C.slateLight),
    path("M66 246 V196 Q66 112 200 112 H200 V246 Z", C.slate),
    bud(138, -1),
    bud(262, 1),
    path("M54 262 Q54 232 88 232 H312 Q346 232 346 262 V316 Q346 362 298 362 H102 Q54 362 54 316 Z", C.slate),
    path("M54 262 Q54 232 88 232 H200 V362 H102 Q54 362 54 316 Z", C.slateLight),
    path("M54 262 Q54 232 88 232 H312 Q346 232 346 262 V276 H54 Z", C.yellow),
    rect(54, 272, 292, 6, 0, C.yellowDeep),
    circle(200, 326, 9, C.accent),
    rect(168, 298, 64, 6, 3, C.slateDeep),
  ].join("");
}

function powerbank(): string {
  const bars = [0, 1, 2, 3, 4]
    .map((i) => rect(110 + i * 26, 196, 18, 38, 5, i < 4 ? C.accent : C.slateLight))
    .join("");
  return [
    path("M58 138 L90 96 H310 L342 138 Z", C.slateLight),
    rect(120, 108, 40, 18, 5, C.black),
    rect(176, 108, 40, 18, 5, C.black),
    rect(232, 108, 52, 18, 9, C.black),
    rect(124, 112, 32, 5, 2.5, C.yellow),
    rect(180, 112, 32, 5, 2.5, C.yellow),
    rect(58, 138, 284, 168, 30, C.slate),
    rect(58, 138, 284, 52, 26, C.slate),
    rect(58, 138, 284, 10, 5, C.slateLight),
    rect(298, 138, 44, 168, 22, C.slateDeep),
    rect(96, 170, 208, 84, 18, C.black),
    bars,
    stroke("M130 154 H270", C.yellow, 6),
    path("M214 270 l-18 22 h12 l-8 18 l26 -26 h-12 l8 -14 Z", C.pink),
    circle(110, 288, 6, C.yellow),
    circle(130, 288, 6, C.yellow),
    circle(150, 288, 6, C.slateLight),
    rect(48, 322, 304, 14, 7, C.slateDeep),
  ].join("");
}

function fan(): string {
  const blades = [0, 90, 180, 270]
    .map((a) => `<g transform="rotate(${a + 20} 200 160)">${path("M200 160 Q150 90 196 44 Q236 80 214 156 Z", C.yellow)}${path("M200 160 Q196 100 196 44 Q226 84 214 156 Z", C.yellowDeep)}</g>`)
    .join("");
  const spokes = [0, 30, 60, 90, 120, 150]
    .map((a) => `<g transform="rotate(${a} 200 160)">${rect(198, 28, 4, 264, 2, C.slateLight)}</g>`)
    .join("");
  return [
    path("M182 300 H218 L228 338 H172 Z", C.slate),
    rect(116, 330, 168, 28, 14, C.slate),
    rect(116, 330, 168, 8, 4, C.slateLight),
    stroke("M284 346 Q336 346 336 312 Q336 286 312 286", C.black, 5),
    rect(300, 276, 28, 20, 5, C.steelMid),
    circle(200, 160, 132, C.slateDeep),
    circle(200, 160, 120, C.slate),
    blades,
    spokes,
    `<circle cx="200" cy="160" r="104" stroke="${C.slateLight}" stroke-width="5"/>`,
    `<circle cx="200" cy="160" r="70" stroke="${C.slateLight}" stroke-width="5"/>`,
    `<circle cx="200" cy="160" r="36" stroke="${C.slateLight}" stroke-width="5"/>`,
    `<circle cx="200" cy="160" r="132" stroke="${C.steelMid}" stroke-width="8"/>`,
    circle(200, 160, 20, C.pink),
    circle(200, 160, 8, C.black),
  ].join("");
}

function crate(): string {
  const can = (x: number, y: number, h: number, band: string): string =>
    [
      rect(x, y, 52, h, 8, C.accent),
      rect(x + 32, y, 20, h, 8, C.accentDeep),
      rect(x, y + h * 0.4, 52, h * 0.26, 0, band),
      rect(x + 8, y + 10, 8, h * 0.6, 4, C.steelLight),
      `<ellipse cx="${x + 26}" cy="${y}" rx="26" ry="8" fill="${C.steelMid}"/>`,
      `<ellipse cx="${x + 26}" cy="${y}" rx="18" ry="5" fill="${C.steelDark}"/>`,
      circle(x + 26, y - 1, 3, C.steelLight),
    ].join("");
  const back = [0, 1, 2, 3, 4, 5].map((i) => can(48 + i * 52, 150, 90, i % 2 === 0 ? C.pink : C.yellow)).join("");
  const front = [0, 1, 2, 3, 4, 5].map((i) => can(22 + i * 56, 188, 90, i % 2 === 0 ? C.yellow : C.pink)).join("");
  const slots = [0, 1, 2, 3, 4, 5].map((i) => rect(44 + i * 56, 262, 36, 56, 10, C.black)).join("");
  return [
    back,
    front,
    rect(14, 232, 372, 122, 12, C.yellow),
    rect(14, 232, 372, 14, 0, C.yellowDeep),
    rect(14, 340, 372, 14, 0, C.yellowDeep),
    slots,
    rect(14, 232, 20, 122, 10, C.yellowDeep),
    rect(366, 232, 20, 122, 10, C.yellowDeep),
  ].join("");
}

function categoryKitchen(): string {
  return [
    steel("ck-pot", (fill) => path("M92 190 H308 V290 Q308 342 256 342 H144 Q92 342 92 290 Z", fill), `<path d="M92 190 H308 V290 Q308 342 256 342 H144 Q92 342 92 290 Z"/>`, 92, 216, 190, 152),
    steel("ck-lid", (fill) => path("M84 190 Q90 140 200 136 Q310 140 316 190 Z", fill), `<path d="M84 190 Q90 140 200 136 Q310 140 316 190 Z"/>`, 84, 232, 136, 54),
    circle(200, 122, 16, C.yellow),
    rect(30, 214, 66, 24, 12, C.black),
    rect(304, 214, 66, 24, 12, C.black),
    stroke("M250 70 q-16 -24 0 -40", C.steelLight, 6),
    stroke("M290 78 q-16 -24 0 -40", C.steelLight, 6),
  ].join("");
}

function categoryFashion(): string {
  return [
    stroke("M200 78 V104 Q200 120 180 126 L72 186 Q56 196 66 212 H334 Q344 196 328 186 L220 126 Q200 120 200 104", C.steelLight, 10),
    stroke("M200 78 a14 14 0 1 0 -14 -14", C.steelLight, 10),
    path("M96 214 L304 214 L340 360 L60 360 Z", C.pink),
    path("M96 214 L150 214 L130 360 L60 360 Z", "#e01d82"),
    rect(60, 330, 280, 30, 0, C.black),
    [84, 126, 168, 210, 252, 294].map((x) => path(`M${x} 345 l10 -10 l10 10 l-10 10 Z`, C.yellow)).join(""),
  ].join("");
}

function categoryElectronics(): string {
  const pins = [0, 1, 2, 3, 4].map((i) => rect(124 + i * 34, 52, 16, 40, 5, C.steelMid) + rect(124 + i * 34, 308, 16, 40, 5, C.steelMid)).join("");
  const side = [0, 1, 2, 3, 4].map((i) => rect(52, 124 + i * 34, 40, 16, 5, C.steelMid) + rect(308, 124 + i * 34, 40, 16, 5, C.steelMid)).join("");
  return [
    pins,
    side,
    rect(84, 84, 232, 232, 28, C.slate),
    rect(84, 84, 116, 232, 28, C.slateLight),
    rect(160, 84, 40, 232, 0, C.slateLight),
    rect(200, 84, 116, 232, 0, C.slate),
    rect(280, 84, 36, 232, 0, C.slateDeep),
    rect(130, 130, 140, 140, 18, C.black),
    circle(200, 200, 34, C.yellow),
    path("M206 168 l-26 38 h20 l-6 28 l30 -42 h-20 Z", C.black),
    circle(106, 106, 7, C.pink),
  ].join("");
}

function categoryBeverages(): string {
  return [
    rect(120, 70, 160, 270, 24, C.accent),
    rect(220, 70, 60, 270, 24, C.accentDeep),
    rect(120, 170, 160, 90, 0, C.pink),
    rect(120, 170, 160, 12, 0, C.black),
    rect(120, 248, 160, 12, 0, C.black),
    rect(140, 90, 18, 220, 9, C.steelLight),
    `<ellipse cx="200" cy="70" rx="80" ry="22" fill="${C.steelMid}"/>`,
    `<ellipse cx="200" cy="70" rx="56" ry="14" fill="${C.steelDark}"/>`,
    rect(190, 56, 20, 8, 4, C.steelLight),
    circle(78, 130, 12, C.yellow),
    circle(322, 190, 9, C.yellow),
    circle(310, 112, 7, C.pink),
  ].join("");
}

const DRAWINGS: Drawing[] = [
  { name: "steel-tiffin-3", body: tiffin() },
  { name: "pressure-cooker-5l", body: cooker() },
  { name: "copper-bottle-1l", body: bottle() },
  { name: "ilkal-saree", body: saree() },
  { name: "cotton-kurta", body: kurta() },
  { name: "dhwani-speaker", body: speaker() },
  { name: "tara-smartwatch", body: watch() },
  { name: "lehar-earbuds", body: earbuds() },
  { name: "jugnu-powerbank", body: powerbank() },
  { name: "pankha-desk-fan", body: fan() },
  { name: "jaljeera-fizz-24", body: crate() },
  { name: "category-kitchen", body: categoryKitchen() },
  { name: "category-fashion", body: categoryFashion() },
  { name: "category-electronics", body: categoryElectronics() },
  { name: "category-beverages", body: categoryBeverages() },
];

mkdirSync(OUT, { recursive: true });
for (const drawing of DRAWINGS) writeFileSync(join(OUT, `${drawing.name}.svg`), svg(drawing.body));
console.log(`wrote ${DRAWINGS.length} drawings to ${OUT}`);
