import type { Tone } from "./types";

export const TILE_COLOURS: Record<Tone, string> = {
  orange: "#ff7a1a",
  sage: "#b4c4ac",
  yellow: "#e6f24a",
  black: "#0b0b0b",
};

const escapeText = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The drawn "folded return": a sheet with one folded corner, stamped with the state code and the period,
 * in black lines (light lines on a black tile). The browser and the PDF packet draw it from this one function.
 */
export function foldedReturnSvg(code: string, periodLabel: string, tone: Tone): string {
  const line = tone === "black" ? "#f4f4ee" : "#000000";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250" role="img" aria-hidden="true" focusable="false" fill="none" stroke="${line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">`
    + `<path d="M46 34H128L158 64V216H46Z"/><path d="M128 34V64H158"/>`
    + `<path d="M62 84H108M62 98H140M62 112H140" stroke-width="2.5"/>`
    + `<rect x="62" y="132" width="60" height="38" rx="0"/>`
    + `<text x="92" y="159" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif" font-size="25" font-weight="800" fill="${line}" stroke="none">${escapeText(code)}</text>`
    + `<path d="M62 190H140" stroke-width="2.5"/>`
    + `<text x="62" y="207" font-family="'Plus Jakarta Sans', sans-serif" font-size="13" font-weight="700" fill="${line}" stroke="none">${escapeText(periodLabel)}</text>`
    + `</svg>`;
}
