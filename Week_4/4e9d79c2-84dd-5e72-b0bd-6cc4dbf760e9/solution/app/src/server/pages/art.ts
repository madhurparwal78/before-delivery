// Every drawing here is generated for this app: flat side views of invented vehicles, plain scenes and an outline icon set at a two-pixel stroke.
import { raw, type Markup } from "../html.js";

const ICONS: Record<string, string> = {
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.800 7 11 7 11z"/><circle cx="12" cy="10" r="2.500"/>',
  flag: '<path d="M6 21V4h11l-2 4 2 4H6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6M16 5.500a3 3 0 0 1 0 5M18 14c2 .8 3 3 3 6"/>',
  bagLarge: '<rect x="6" y="6" width="12" height="15"/><path d="M10 6V2h4v4M10 10v7M14 10v7"/>',
  bagMedium: '<rect x="5" y="10" width="14" height="10"/><path d="M9 10V6h6v4M5 14h14"/>',
  bagHand: '<path d="M7 11h10l2 9H5z"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8z"/><path d="M8 8h.5"/>',
  percent: '<path d="M6 18L18 6"/><rect x="5" y="5" width="4" height="4"/><rect x="15" y="15" width="4" height="4"/>',
  wheelchair: '<circle cx="10" cy="4.500" r="1.500"/><path d="M10 7v7h6l2 5M10 10h5"/><path d="M8 11.500a5 5 0 1 0 6.500 6.500"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3-6.500 7-6.500s7 2.500 7 6.500"/>',
  mail: '<rect x="3" y="6" width="18" height="13"/><path d="M3 7l9 7 9-7"/>',
  phone: '<path d="M6 3h3l2 5-2.500 1.500a12 12 0 0 0 6 6L16 13l5 2v3a3 3 0 0 1-3 3C10 21 3 14 3 6a3 3 0 0 1 3-3z"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l5 5"/>',
  check: '<path d="M4 12.500l5 5L20 6.500"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  note: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
  seat: '<path d="M6 2h6v5h-1l1 7h8v5H8L6.500 7H6z"/><path d="M14 19v3M10 22h8"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
  pound: '<path d="M16 7a4 4 0 0 0-7 2v9H6h11M6 13h8"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/><path d="M8.500 12l2.500 2.500 4.500-4.500"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
};
export const icon = (name: string, size = 20): Markup =>
  raw(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`);

/** A flat side view of an invented coach or minibus; the window count follows its seats. */
const vehicleLength = (seats: number): number => (seats >= 49 ? 330 : seats >= 31 ? 280 : seats >= 16 ? 210 : seats >= 12 ? 180 : 150);
const vehicleHeight = (seats: number): number => (seats >= 70 ? 118 : seats >= 31 ? 92 : 74);
const vehicle = (x: number, y: number, seats: number, body: string, glass: string, trim: string): string => {
  const length = vehicleLength(seats);
  const height = vehicleHeight(seats);
  const windows = Math.max(3, Math.round(length / 48));
  const width = (length - 70) / windows;
  const paneTop = seats >= 70 ? y + 50 : y + 14;
  const paneHeight = seats >= 70 ? 26 : height * 0.36;
  const row = (top: number, tall: number): string => Array.from({ length: windows }, (_, i) => `<rect x="${x + 56 + i * width}" y="${top}" width="${width - 6}" height="${tall}" fill="${glass}"/>`).join("");
  const panes = row(paneTop, paneHeight) + (seats >= 70 ? row(y + 12, 26) : "");
  const lift = seats === 16 || seats === 49 ? `<rect x="${x + length * 0.5}" y="${y + height * 0.5}" width="26" height="${height * 0.5}" fill="${trim}"/><rect x="${x + length * 0.5 + 4}" y="${y + height * 0.5 + 4}" width="18" height="${height * 0.22}" fill="${glass}"/>` : "";
  const front = x + Math.max(length * 0.22, 40);
  const rear = x + length - Math.max(length * 0.18, 34);
  return `<g><path d="M${x} ${y + height}V${y + 24}L${x + 28} ${y}H${x + length}V${y + height}Z" fill="${body}"/>
    <path d="M${x + 4} ${y + 25}L${x + 30} ${y + 8}H${x + 50}V${y + 14 + height * 0.36}H${x + 4}Z" fill="${glass}"/>${panes}
    <rect x="${x}" y="${y + height * 0.66}" width="${length}" height="6" fill="${trim}"/>${lift}
    <circle cx="${front}" cy="${y + height + 2}" r="15" fill="#33044A"/><circle cx="${front}" cy="${y + height + 2}" r="6" fill="${glass}"/>
    <circle cx="${rear}" cy="${y + height + 2}" r="15" fill="#33044A"/><circle cx="${rear}" cy="${y + height + 2}" r="6" fill="${glass}"/></g>`;
};
const PLUM = "#33044A";
const CYAN = "#2FBAD1";

/** The hero's long coach, drawn to run off the frame's right edge. */
const heroCoach = (x: number, y: number, scale: number, rearWheel: number): string => {
  const windows = Array.from({ length: 9 }, (_, i) => `<rect x="${172 + i * 94}" y="14" width="84" height="66" fill="${PLUM}"/>`).join("");
  const wheel = (at: number): string => `<circle cx="${at}" cy="150" r="30" fill="${PLUM}"/><circle cx="${at}" cy="150" r="15" fill="#FFFFFF"/><circle cx="${at}" cy="150" r="5" fill="${PLUM}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0 150V46L54 0H1000V150Z" fill="#FFFFFF"/>
    <path d="M10 88V50L58 12H98V88Z" fill="${PLUM}"/><rect x="106" y="12" width="54" height="124" fill="${PLUM}"/><rect x="131" y="12" width="4" height="124" fill="#FFFFFF"/>${windows}
    <rect x="160" y="92" width="840" height="10" fill="${CYAN}"/><rect x="160" y="108" width="840" height="4" fill="${PLUM}"/>${wheel(70)}${wheel(rearWheel)}</g>`;
};
const heroScene = (cls: string, width: number, skyline: number[][], windowsFrom: number, coach: string): string => `<svg class="hero-art ${cls}" viewBox="0 0 ${width} 400" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
  <rect width="${width}" height="400" fill="${CYAN}"/>
  ${skyline.map(([x, top, w]) => `<rect x="${x}" y="${top}" width="${w}" height="${350 - top}" fill="${PLUM}"/>${Array.from({ length: Math.floor(w / 42) }, (_, i) => Array.from({ length: 5 }, (_, r) => (windowsFrom + r * 40 < 332 ? `<rect x="${x + 12 + i * 42}" y="${windowsFrom + r * 40}" width="22" height="24" fill="${CYAN}"/>` : "")).join("")).join("")}`).join("")}
  <rect y="350" width="${width}" height="50" fill="${PLUM}"/>${Array.from({ length: Math.ceil(width / 120) }, (_, i) => `<rect x="${i * 120 + 20}" y="380" width="60" height="5" fill="${CYAN}"/>`).join("")}
  ${coach}
</svg>`;
export const heroStreet = (): Markup => raw(
  heroScene("hero-art-wide", 1280, [[0, 150, 170], [170, 110, 150], [320, 170, 130], [450, 100, 200], [650, 140, 170], [820, 90, 210], [1030, 130, 250]], 200, heroCoach(470, 195, 1, 650))
  + heroScene("hero-art-narrow", 600, [[0, 180, 130], [130, 215, 90], [220, 190, 170], [390, 210, 210]], 240, heroCoach(215, 240, 0.72, 470)));

const SCENES: Record<string, string> = {
  school: `<rect x="60" y="90" width="300" height="170" fill="#33044A"/><path d="M40 90L210 20l170 70z" fill="#33044A"/><rect x="190" y="180" width="42" height="80" fill="#2FBAD1"/>${[90, 140, 250, 300].map((x) => `<rect x="${x}" y="120" width="30" height="40" fill="#2FBAD1"/><rect x="${x}" y="190" width="30" height="40" fill="#2FBAD1"/>`).join("")}<circle cx="210" cy="70" r="16" fill="#FFFFFF"/>`,
  weddings: `<rect x="110" y="120" width="210" height="140" fill="#33044A"/><path d="M90 120L215 40l125 80z" fill="#33044A"/><rect x="195" y="10" width="40" height="70" fill="#33044A"/><path d="M215 0v40M203 14h24" stroke="#FFFFFF" stroke-width="4"/><path d="M190 260v-60a25 25 0 0 1 50 0v60z" fill="#2FBAD1"/><path d="M0 26L195 56M235 56L420 26" stroke="#33044A" stroke-width="3" fill="none"/>${[[28, 30], [84, 39], [140, 47], [270, 50], [326, 41], [382, 32]].map(([x, y]) => `<path d="M${x} ${y}l10 18 10-18z" fill="#33044A"/>`).join("")}`,
  company: `<rect x="70" y="30" width="120" height="230" fill="#33044A"/><rect x="200" y="90" width="150" height="170" fill="#33044A"/>${Array.from({ length: 6 }, (_, r) => [86, 118, 150].map((x) => `<rect x="${x}" y="${46 + r * 34}" width="20" height="22" fill="#2FBAD1"/>`).join("")).join("")}${Array.from({ length: 4 }, (_, r) => [218, 256, 294].map((x) => `<rect x="${x}" y="${106 + r * 36}" width="24" height="22" fill="#FFFFFF"/>`).join("")).join("")}`,
  festivals: `<path d="M60 260V110h280v150" fill="#33044A"/><path d="M40 110L200 30l160 80z" fill="#2FBAD1"/><rect x="90" y="150" width="220" height="110" fill="#2FBAD1"/><path d="M104 196l44-40 34 18 32-30 56 52z" fill="#33044A"/>${[20, 370].map((x) => `<rect x="${x}" y="60" width="8" height="200" fill="#33044A"/><rect x="${x - 14}" y="44" width="36" height="20" fill="#FFFFFF"/>`).join("")}`,
};
/** A plain drawing for one occasion: its place and an invented vehicle waiting outside. */
export const occasionArt = (occasion: string, seats: number, className: string, ground = "#2FBAD1"): Markup =>
  raw(`<svg class="${className}" viewBox="0 0 420 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"><rect width="420" height="300" fill="${ground}"/>${SCENES[occasion]}<rect y="260" width="420" height="40" fill="#33044A"/>${vehicle(96, 186, Math.min(seats, 31), "#FFFFFF", ground === "#2FBAD1" ? "#2FBAD1" : "#33044A", "#33044A")}</svg>`);

export const fleetSide = (seats: number): Markup =>
  raw(`<svg class="fleet-art" viewBox="0 0 420 150" aria-hidden="true" focusable="false"><rect width="420" height="150" fill="#2FBAD1"/><rect y="124" width="420" height="26" fill="#33044A"/>${vehicle((420 - vehicleLength(seats)) / 2, 122 - vehicleHeight(seats), seats, "#FFFFFF", "#33044A", "#33044A")}</svg>`);

export const wordmark = (): Markup => raw(`<span class="wordmark"><svg viewBox="0 0 72 34" width="72" height="34" aria-hidden="true" focusable="false"><path d="M2 26V10L12 2h58v24z" fill="${PLUM}"/><rect x="18" y="8" width="11" height="9" fill="${CYAN}"/><rect x="32" y="8" width="11" height="9" fill="${CYAN}"/><rect x="46" y="8" width="11" height="9" fill="${CYAN}"/><circle cx="17" cy="27" r="5" fill="${PLUM}"/><circle cx="55" cy="27" r="5" fill="${PLUM}"/></svg><span class="wordmark-text">Merrowfield</span></span>`);

export const mastheadCoach = (): Markup => raw(`<svg viewBox="0 0 350 112" width="180" height="58" aria-hidden="true" focusable="false">${vehicle(10, 2, 49, "#33044A", "#2FBAD1", "#FFFFFF")}</svg>`);

const GREY = "#767676";
const MARKS: [string, string][] = [
  ["Harbury Tile", `<path d="M2 3h9v8H2zM13 3h9v8h-9zM7 13h10v8H7z" fill="${GREY}"/>`],
  ["Northgate Joinery", `<path d="M2 4h20v7H17l3 9H4l3-9H2z" fill="${GREY}"/>`],
  ["Quinton Choir", `<path d="M8 3h13v14.500a3.500 3.500 0 1 1-2-3.150V8H10v11.500a3.500 3.500 0 1 1-2-3.150z" fill="${GREY}"/>`],
  ["Ansty Rovers", `<path d="M3 2h18v11c0 4-4 7-9 9-5-2-9-5-9-9z" fill="${GREY}"/><path d="M6 11l6-5 6 5M6 16l6-5 6 5" stroke="#FFFFFF" stroke-width="2" fill="none"/>`],
  ["Binley Press", `<path d="M4 2h16v20H4z" fill="${GREY}"/><path d="M7 7h10M7 11h10M7 15h6" stroke="#FFFFFF" stroke-width="2"/>`],
  ["Canley Cycles", `<circle cx="12" cy="12" r="9" stroke="${GREY}" stroke-width="3" fill="none"/><path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18" stroke="${GREY}" stroke-width="1.500"/>`],
  ["Whitley Bakers", `<path d="M2 12c0-5 4-7 10-7s10 2 10 7c0 1.500-1 2-2 2v6H4v-6c-1 0-2-.5-2-2z" fill="${GREY}"/><path d="M8 9v5M12 9v5M16 9v5" stroke="#FFFFFF" stroke-width="2"/>`],
  ["Tile Hill Scouts", `<path d="M12 2l10 20h-7l-3-7-3 7H2z" fill="${GREY}"/>`],
];
export const clientMarks = (): Markup => raw(MARKS.map(([name, mark]) =>
  `<li class="mark"><svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false">${mark}</svg><span>${name}</span></li>`).join(""));
