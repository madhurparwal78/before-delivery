import { drawing } from "../dom.js";

function seedOf(text: string): number {
  let seed = 7;
  for (const character of text) seed = (seed * 31 + character.charCodeAt(0)) % 9973;
  return seed;
}

/** An abstract head-and-shoulders portrait in the interview's own hue; the slug picks the silhouette. */
export function portrait(hue: number, slug: string): SVGSVGElement {
  const seed = seedOf(slug);
  const ground = `hsl(${hue} 42% 84%)`;
  const body = `hsl(${hue} 46% 32%)`;
  const skin = `hsl(${hue} 40% 62%)`;
  const hair = `hsl(${hue} 44% 22%)`;
  const shoulders = [
    "M8 96 C10 70 30 62 48 62 C66 62 86 70 88 96 Z",
    "M4 96 C8 74 22 66 48 66 C74 66 88 74 92 96 Z",
    "M14 96 C14 66 34 58 48 58 C62 58 82 66 82 96 Z",
  ][seed % 3];
  const hairShape = [
    `<path fill="${hair}" d="M30 40 C28 22 40 14 50 14 C62 14 70 24 66 42 C60 32 40 30 30 40 Z"/>`,
    `<path fill="${hair}" d="M28 48 C24 22 38 12 50 12 C64 12 74 24 68 50 L66 62 C64 44 60 34 48 34 C38 34 32 44 30 62 Z"/>`,
    `<circle cx="48" cy="12" r="9" fill="${hair}"/><path fill="${hair}" d="M30 40 C30 24 40 18 50 18 C60 18 68 26 66 40 C58 32 40 32 30 40 Z"/>`,
  ][(seed >> 2) % 3];
  const accessory = [
    `<g fill="none" stroke="${hair}" stroke-width="1.6"><circle cx="41" cy="44" r="6"/><circle cx="55" cy="44" r="6"/><path d="M47 44h2"/></g>`,
    `<circle cx="31" cy="52" r="2.4" fill="${body}"/><circle cx="65" cy="52" r="2.4" fill="${body}"/>`,
    "",
  ][(seed >> 4) % 3];
  const frame = [`<rect width="96" height="96" rx="12" fill="${ground}"/>`, `<circle cx="48" cy="48" r="48" fill="${ground}"/>`, `<path d="M0 96 V40 C0 14 24 0 48 0 C72 0 96 14 96 40 V96 Z" fill="${ground}"/>`][(seed >> 6) % 3];
  return drawing(`<svg class="portrait" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false">
    ${frame}
    <path fill="${body}" d="${shoulders}"/>
    <path fill="${skin}" d="M42 56 h12 v10 c0 4 -12 4 -12 0 Z"/>
    <ellipse cx="48" cy="44" rx="15" ry="18" fill="${skin}"/>
    ${hairShape}
    ${accessory}
  </svg>`);
}
