/**
 * Original procedural artwork for the published media objects. Each project has
 * a distinct palette and motif; the six frames of one project differ visibly.
 */
import { Png, hexToRgb, type Rgb } from "./png.js";

type Palette = { paper: string; ink: string; accent: string; tint: string };

const PALETTES: Record<string, Palette> = {
  "hollis-atelier": { paper: "#f2efe7", ink: "#1d1f24", accent: "#2547d4", tint: "#d8d3c4" },
  "foundry-loop": { paper: "#f5f1e8", ink: "#23211d", accent: "#2547d4", tint: "#e0d6b8" },
  "tallyhouse": { paper: "#eef1ea", ink: "#20241f", accent: "#2547d4", tint: "#cdd8cb" },
  "pulse-roster": { paper: "#f0f2f4", ink: "#1e2429", accent: "#2547d4", tint: "#c9d6dd" },
  tidegauge: { paper: "#ecf1f2", ink: "#16262b", accent: "#2547d4", tint: "#bfd4d8" },
  promptloom: { paper: "#f4f0f6", ink: "#261f2a", accent: "#2547d4", tint: "#ddd0e2" },
};


export function coverImage(slug: string): Buffer {
  const palette = PALETTES[slug];
  const w = 960;
  const h = 640;
  const png = new Png(w, h, hexToRgb(palette.paper));
  const ink = hexToRgb(palette.ink);
  const accent = hexToRgb(palette.accent);
  const tint = hexToRgb(palette.tint);
  drawMotif(png, slug, ink, accent, tint, 1);
  png.text(slug.replace(/-/g, " ").toUpperCase(), 40, h - 60, 6, ink);
  png.text("QUILLFERN WORKS PORTFOLIO", 40, 40, 3, ink);
  return png.encode();
}

export function frameImage(slug: string, frame: number): Buffer {
  const palette = PALETTES[slug];
  const w = 960;
  const h = 600;
  const png = new Png(w, h, hexToRgb(palette.paper));
  const ink = hexToRgb(palette.ink);
  const accent = hexToRgb(palette.accent);
  const tint = hexToRgb(palette.tint);
  drawMotif(png, slug, ink, accent, tint, frame);
  png.text(`FRAME ${frame} / 6`, 40, 40, 4, ink);
  return png.encode();
}

/** The motif differs per project and per frame so the six frames are visibly distinct. */
function drawMotif(
  png: Png,
  slug: string,
  ink: Rgb,
  accent: Rgb,
  tint: Rgb,
  frame: number
): void {
  const h = png.height;
  switch (slug) {
    case "hollis-atelier": {
      // stacked plan drawing; each frame slides one storey further open
      for (let i = 0; i < 5; i++) {
        const y = h - 80 - i * 70;
        const open = (i + frame) % 6;
        png.outlinedRect(90 + i * 24, y, 560 - i * 24, 52, 3, ink);
        for (let r = 0; r <= open; r++) {
          png.rect(120 + i * 24 + r * 36, y + 8, 20, 36, tint);
        }
        png.rect(700, y, 40, 52, (i + frame) % 2 === 0 ? ink : accent);
      }
      png.rect(90, h - 60, 560, 6, accent);
      break;
    }
    case "foundry-loop": {
      // reel strip with a moving playhead
      for (let i = 0; i < 8; i++) {
        const x = 60 + i * 110;
        png.rect(x, 140 + (i % 3) * 46, 84, 190, i % 3 === 1 ? tint : ink);
        png.outlinedRect(x, 140 + (i % 3) * 46, 84, 190, 3, ink);
      }
      const playhead = 80 + ((frame - 1) * 120) % 880;
      png.rect(playhead, 120, 8, 240, accent);
      png.circle(playhead + 4, 120, 18, 6, accent);
      png.line(60, 420, 900, 420, 3, ink);
      for (let i = 0; i < 12; i++) png.dot(60 + i * 76, 420, 8, i === frame % 12 ? accent : ink);
      break;
    }
    case "tallyhouse": {
      // calendar grid with a moving highlighted booking
      png.outlinedRect(70, 90, 500, 420, 4, ink);
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 6; c++) {
          png.rect(90 + c * 80, 110 + r * 80, 68, 68, (r + c) % 2 === 0 ? tint : ink);
        }
      }
      const cell = (frame - 1) % 30;
      png.outlinedRect(90 + (cell % 6) * 80, 110 + Math.floor(cell / 6) * 80, 68, 68, 6, accent);
      png.outlinedRect(620, 90, 280, 200, 4, ink);
      for (let i = 0; i < frame * 2; i++) png.rect(640 + (i % 6) * 40, 110 + Math.floor(i / 6) * 40, 28, 24, i % 3 === 0 ? accent : tint);
      png.text("USAGE", 640, 330, 5, ink);
      for (let i = 0; i < 7; i++) png.rect(640, 500 - i * 24, 20 + (i * 9 + frame * 6) % 180, 14, i === frame % 7 ? accent : ink);
      break;
    }
    case "pulse-roster": {
      // live shift board: a grid of shifts, filled cells follow the frame
      png.outlinedRect(60, 80, 840, 300, 4, ink);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 10; c++) {
          const filled = (r * 10 + c) % 7 < frame;
          png.rect(80 + c * 82, 100 + r * 68, 70, 52, filled ? accent : tint);
          png.outlinedRect(80 + c * 82, 100 + r * 68, 70, 52, 3, ink);
        }
      }
      png.text("LIVE SHIFT BOARD", 60, 430, 4, ink);
      png.line(60, 480, 900, 480, 3, ink);
      for (let i = 0; i < 5; i++) png.dot(80 + i * 90 + frame * 6, 520 + (i % 2) * 20, 12, i % 2 === 0 ? accent : ink);
      break;
    }
    case "tidegauge": {
      // streaming chart whose wave advances with the frame
      png.outlinedRect(50, 60, 860, 360, 4, ink);
      for (let x = 0; x <= 840; x += 70) png.line(60 + x, 70, 60 + x, 410, 2, tint);
      for (let y = 0; y <= 6; y++) png.line(60, 70 + y * 56, 900, 70 + y * 56, 2, tint);
      for (let x = 0; x < 840; x++) {
        const t = (x / 840) * Math.PI * 4 + (frame - 1) * 0.8;
        const y = 240 + Math.sin(t) * 90 + Math.sin(t * 3) * 24;
        png.dot(60 + x, y, 5, x % 70 === 0 ? accent : ink);
      }
      png.text("STATION PICKER", 60, 460, 4, ink);
      for (let i = 0; i < 6; i++) png.outlinedRect(60 + i * 140, 490, 120, 60, 4, i === (frame - 1) % 6 ? accent : ink);
      break;
    }
    default: {
      // promptloom: recipe cards and a moodboard that fills with the frame
      for (let i = 0; i < 3; i++) {
        png.outlinedRect(60 + i * 60, 80 + i * 30, 360, 240, 4, ink);
        png.rect(80 + i * 60, 100 + i * 30, 320 - i * 40, 40, accent);
      }
      for (let i = 0; i < frame * 3; i++) {
        const x = 560 + (i % 4) * 88;
        const y = 100 + Math.floor(i / 4) * 88;
        png.rect(x, y, 76, 76, i % 3 === 0 ? tint : ink);
        png.outlinedRect(x, y, 76, 76, 3, ink);
      }
      png.outlinedRect(540, 84, 380, 380, 4, ink);
      png.text("EXPORT TO SLIDES", 60, 490, 5, ink);
      for (let i = 0; i < frame; i++) png.rect(60 + i * 100, 520, 80, 40, i % 2 === 0 ? accent : ink);
      break;
    }
  }
}

