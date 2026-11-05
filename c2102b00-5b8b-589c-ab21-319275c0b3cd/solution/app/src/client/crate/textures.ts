// Drawn textures for the crate: corrugated kraft with packing tape, and the inked rubber stamps.
// Stamp lettering is set in the display face and only drawn once that face has loaded.
import type { StampKind } from "./model.js";

const STAMP_COLOUR: Record<StampKind, string> = { sealed: "#1d4a2c", taken_up: "#1d4a2c", dropped: "#1e1a15" };
const STAMP_TEXT: Record<StampKind, string> = { sealed: "SEALED", taken_up: "TAKEN UP", dropped: "DROPPED" };

const DISPLAY_FACE = '900 120px "Archivo"';

export function displayFaceReady(): boolean {
  return document.fonts.check(DISPLAY_FACE);
}

export function loadDisplayFace(): Promise<unknown> {
  return document.fonts.load(DISPLAY_FACE);
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext("2d")!];
}

/** A small deterministic generator, so a stamp's unevenness is the same on every draw. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Corrugated kraft with fine flutes, and optionally a strip of packing tape down its middle. */
export function kraftCanvas(base: string, flute: string, tape: "none" | "across" | "along"): HTMLCanvasElement {
  const [canvas, ctx] = canvasOf(256, 128);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = flute;
  for (let x = 0; x < 256; x += 8) {
    ctx.globalAlpha = 0.32;
    ctx.fillRect(x, 0, 3, 128);
    ctx.globalAlpha = 0.14;
    ctx.fillRect(x + 3, 0, 2, 128);
  }
  ctx.globalAlpha = 1;
  const rand = seeded(7);
  ctx.fillStyle = flute;
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.12 + rand() * 0.12;
    ctx.fillRect(rand() * 256, rand() * 128, 1 + rand() * 3, 1);
  }
  ctx.globalAlpha = 1;
  if (tape !== "none") {
    const [x, y, w, h] = tape === "across" ? [104, 0, 48, 128] : [0, 50, 256, 28];
    ctx.fillStyle = "#dccfa6";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(30,26,21,.55)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.beginPath();
    if (tape === "across") {
      ctx.moveTo(x + 10, 0);
      ctx.lineTo(x + 10, 128);
    } else {
      ctx.moveTo(0, y + 8);
      ctx.lineTo(256, y + 8);
    }
    ctx.stroke();
  }
  return canvas;
}

/** An inked rubber stamp: a ruled frame and letters set in the display face, each a little off true. */
export function stampCanvas(kind: StampKind): HTMLCanvasElement {
  const [canvas, ctx] = canvasOf(512, 192);
  const rand = seeded(kind.length * 97 + 11);
  const colour = STAMP_COLOUR[kind];
  ctx.translate(256, 96);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 5;
  ctx.strokeRect(-236, -80, 472, 160);
  ctx.lineWidth = 2;
  ctx.strokeRect(-224, -68, 448, 136);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const text = STAMP_TEXT[kind];
  let size = 96;
  const set = (px: number) => {
    ctx.font = `900 ${px}px "Archivo"`;
    (ctx as unknown as { fontStretch: string }).fontStretch = "expanded";
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px * 0.04}px`;
  };
  set(size);
  while (ctx.measureText(text).width > 400 && size > 20) set((size -= 4));
  let x = -ctx.measureText(text).width / 2;
  for (const letter of text) {
    ctx.save();
    ctx.translate(x, (rand() - 0.5) * 5);
    ctx.rotate(((rand() - 0.5) * 3 * Math.PI) / 180);
    ctx.fillText(letter, 0, 4);
    ctx.restore();
    x += ctx.measureText(letter).width;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 420; i++) {
    ctx.globalAlpha = 0.5 + rand() * 0.5;
    ctx.fillRect(rand() * 512, rand() * 192, 1 + rand() * 2.5, 1 + rand() * 2.5);
  }
  return canvas;
}
