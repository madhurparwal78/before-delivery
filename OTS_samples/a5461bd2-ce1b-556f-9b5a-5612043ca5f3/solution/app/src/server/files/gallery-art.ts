import type { Colours } from "../../shared/types";
import { random } from "./mesh";

/** Each gallery image is an abstract composition in the project's three colours, 1600 by 1000 units. */

const WIDTH = 1600;
const HEIGHT = 1000;

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}

type Draw = (colours: Colours, noise: () => number) => string;

const circle = (x: number, y: number, r: number, fill: string, opacity = 1) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" opacity="${opacity}"/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, opacity = 1) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" opacity="${opacity}"/>`;

const COMPOSITIONS: Draw[] = [
  ({ ink, accent }, noise) => {
    const lines = Array.from({ length: 18 }, (_, i) => rect(120, 110 + i * 46, 1360, 3, ink, 0.28)).join("");
    return lines + circle(380 + noise() * 200, 500, 250, accent, 0.92) + rect(820, 220, 520, 560, ink, 0.12) + rect(860, 260, 440, 18, accent);
  },
  ({ ink, accent }, noise) => {
    const bars = Array.from({ length: 9 }, (_, i) => rect(150 + i * 150, 760 - (140 + noise() * 480), 90, 140 + noise() * 480 + 100, i % 3 === 0 ? accent : ink, i % 3 === 0 ? 0.95 : 0.3)).join("");
    return bars + rect(120, 790, 1360, 6, ink, 0.6);
  },
  ({ ink, accent }) => {
    const rings = [420, 330, 240, 150].map((r, i) => `<circle cx="800" cy="500" r="${r}" fill="none" stroke="${i % 2 ? accent : ink}" stroke-width="${i % 2 ? 26 : 6}" opacity="${i % 2 ? 0.95 : 0.9}"/>`).join("");
    return rings + circle(800, 500, 70, ink, 0.9) + circle(800, 500, 30, accent);
  },
  ({ ink, accent }, noise) => {
    const slices = Array.from({ length: 14 }, (_, i) => `<path d="M ${200 + i * 90} 880 L ${320 + i * 90} ${180 + noise() * 260} L ${360 + i * 90} 880 Z" fill="${i % 4 === 0 ? accent : ink}" opacity="${i % 4 === 0 ? 0.92 : 0.2 + noise() * 0.2}"/>`).join("");
    return slices;
  },
];

/** The four images of a project: one composition each, every one in the project's ground, ink and accent. */
export function galleryImage(slug: string, n: number, colours: Colours): string {
  const noise = random(hash(`${slug}/${n}`));
  const compose = COMPOSITIONS[(n - 1 + (hash(slug) % COMPOSITIONS.length)) % COMPOSITIONS.length] as Draw;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img">${rect(0, 0, WIDTH, HEIGHT, colours.ground)}${compose(colours, noise)}</svg>`;
}
