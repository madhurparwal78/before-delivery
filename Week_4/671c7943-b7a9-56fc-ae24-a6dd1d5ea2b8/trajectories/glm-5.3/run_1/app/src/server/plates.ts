import type { Project } from "../domain/model.js";

export type PlateKind = "cover" | "hero" | "screen" | "portrait" | "intro";

function hsl(hue: number, sat: number, light: number): string {
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function tonalPair(hue: number, index: number): { light: string; dark: string } {
  const sat = 38 + ((hue + index * 37) % 22);
  return {
    light: hsl(hue, sat, 86 - ((hue + index * 13) % 8)),
    dark: hsl(hue, sat, 24 + ((hue + index * 29) % 12)),
  };
}

function arcsBody(hue: number, width: number, height: number, seed: number): string {
  const cx = width * (0.34 + (seed % 5) * 0.08);
  const cy = height * 0.92;
  let body = "";
  for (let i = 7; i >= 1; i--) {
    const r = (Math.min(width, height) * 0.62 * i) / 7;
    const tone = tonalPair(hue, i);
    body += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${i % 2 === 0 ? tone.dark : tone.light}"/>`;
  }
  const accent = tonalPair(hue, 0);
  body += `<path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} m -${(width * 0.045).toFixed(1)} 0 a ${(width * 0.045).toFixed(1)} ${(width * 0.045).toFixed(1)} 0 1 1 ${(width * 0.09).toFixed(1)} 0" fill="${accent.dark}"/>`;
  return body;
}

function gridBody(hue: number, width: number, height: number, seed: number): string {
  const cols = 5 + (seed % 3);
  const rows = 4 + (seed % 2);
  const cw = width / cols;
  const ch = height / rows;
  let body = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = (r * 31 + c * 17 + seed * 13) % 10;
      const tone = tonalPair(hue, c + r);
      if (n < 3) {
        body += `<rect x="${(c * cw).toFixed(1)}" y="${(r * ch).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="${tone.dark}"/>`;
      } else if (n < 5) {
        body += `<rect x="${(c * cw).toFixed(1)}" y="${(r * ch).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="${tone.light}"/>`;
      }
    }
  }
  for (let c = 0; c <= cols; c++) {
    body += `<line x1="${(c * cw).toFixed(1)}" y1="0" x2="${(c * cw).toFixed(1)}" y2="${height}" stroke="${hsl(hue, 25, 78)}" stroke-width="1"/>`;
  }
  for (let r = 0; r <= rows; r++) {
    body += `<line x1="0" y1="${(r * ch).toFixed(1)}" x2="${width}" y2="${(r * ch).toFixed(1)}" stroke="${hsl(hue, 25, 78)}" stroke-width="1"/>`;
  }
  return body;
}

function stackBody(hue: number, width: number, height: number, seed: number): string {
  const bands = 6;
  const ch = height / bands;
  let body = "";
  for (let i = 0; i < bands; i++) {
    const n = (i * 7 + seed * 5) % 10;
    const tone = tonalPair(hue, i);
    const inset = ((i * 41 + seed * 23) % 4) * (width * 0.08);
    body += `<rect x="${inset.toFixed(1)}" y="${(i * ch).toFixed(1)}" width="${(width - inset * 2).toFixed(1)}" height="${ch.toFixed(1)}" fill="${n < 5 ? tone.dark : tone.light}"/>`;
  }
  const accent = tonalPair(hue, 11);
  body += `<rect x="0" y="${(height * 0.46).toFixed(1)}" width="${width.toFixed(1)}" height="${(height * 0.08).toFixed(1)}" fill="${accent.dark}"/>`;
  return body;
}

export function slugSeed(slug: string): number {
  let hash = 7;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) % 100000;
  }
  return hash;
}

export interface PlateOptions {
  width: number;
  height: number;
  class?: string;
  label?: string;
  hidden?: boolean;
}

export function projectPlateSvg(project: Project, options: PlateOptions): string {
  const { width, height } = options;
  const seed = slugSeed(project.slug);
  const body =
    project.motif === "arcs"
      ? arcsBody(project.hue, width, height, seed)
      : project.motif === "grid"
        ? gridBody(project.hue, width, height, seed)
        : stackBody(project.hue, width, height, seed);
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="${options.hidden ? "none" : "img"}" aria-hidden="${options.hidden ? "true" : "false"}"${options.label ? ` aria-label="${options.label}"` : ""}${options.class ? ` class="${options.class}"` : ""}>${body}</svg>`;
}

export function screenPlateSvg(project: Project, index: number, width: number, height: number): string {
  const seed = (slugSeed(project.slug) + index * 97) % 100000;
  const hue = (project.hue + index * 24) % 360;
  const tone = tonalPair(hue, index + 3);
  const inner = `<rect x="0" y="0" width="${width}" height="${height}" fill="${tone.light}"/>` +
    `<rect x="${(width * 0.08).toFixed(1)}" y="${(height * 0.12).toFixed(1)}" width="${(width * 0.84).toFixed(1)}" height="${(height * 0.72).toFixed(1)}" fill="${tone.dark}" opacity="0.9"/>` +
    `<circle cx="${(width * (0.2 + (seed % 6) * 0.12)).toFixed(1)}" cy="${(height * 0.28).toFixed(1)}" r="${(height * 0.08).toFixed(1)}" fill="${tone.light}"/>` +
    `<rect x="${(width * 0.16).toFixed(1)}" y="${(height * 0.52).toFixed(1)}" width="${(width * 0.5).toFixed(1)}" height="${(height * 0.045).toFixed(1)}" fill="${tone.light}"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}

export function introPlateSvg(): string {
  const width = 640;
  const height = 720;
  let body = "";
  for (let i = 1; i <= 5; i++) {
    body += `<circle cx="${(180 + i * 46).toFixed(0)}" cy="${(560 - i * 62).toFixed(0)}" r="${(40 + i * 34).toFixed(0)}" fill="none" stroke="${i % 2 === 0 ? "#2F5D53" : "#BFD6CF"}" stroke-width="2"/>`;
  }
  body += `<rect x="0" y="640" width="640" height="80" fill="#2F5D53"/>`;
  body += `<path d="M120 640 L520 640" stroke="#F4EFE6" stroke-width="3"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function portraitPlateSvg(): string {
  const width = 480;
  const height = 600;
  const body = `<rect x="0" y="0" width="480" height="600" fill="#EAE3D6"/>` +
    `<circle cx="240" cy="250" r="130" fill="#2F5D53"/>` +
    `<path d="M 90 600 Q 100 430 240 400 Q 380 430 390 600 Z" fill="#26493F"/>` +
    `<circle cx="205" cy="240" r="12" fill="#EAE3D6"/>` +
    `<circle cx="275" cy="240" r="12" fill="#EAE3D6"/>` +
    `<path d="M 215 292 Q 240 310 265 292" stroke="#EAE3D6" stroke-width="6" fill="none"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Portrait of Maren Sollis, drawn">${body}</svg>`;
}

export function swatchBlock(hex: string): string {
  return hex;
}
