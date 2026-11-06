// Procedural prints: the negative with sprocket holes and edge number, the 21-step wedge and the blank frame.
// They are drawn in the same tint as real film and dimmed to 70% brightness when they are not the user's own.
import { sizeCanvas, tintCanvas } from './tint.js';

const DIM = 0.7;

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const grey = (code) => `rgb(${code},${code},${code})`;

function drawNegative(context, width, height, seed) {
  const rand = random(seed);
  context.fillStyle = grey(250);
  context.fillRect(0, 0, width, height);
  const rebate = Math.round(width * 0.11);
  context.fillStyle = grey(0);
  const hole = Math.round(width * 0.05);
  for (let y = height * 0.04; y < height - hole; y += hole * 2.1) {
    context.fillRect(rebate * 0.3, y, hole * 0.7, hole);
    context.fillRect(width - rebate * 0.3 - hole * 0.7, y, hole * 0.7, hole);
  }
  const window = { x: rebate, y: Math.round(height * 0.07), w: width - rebate * 2, h: Math.round(height * 0.8) };
  const sky = context.createLinearGradient(0, window.y, 0, window.y + window.h);
  sky.addColorStop(0, grey(70));
  sky.addColorStop(0.55, grey(150));
  sky.addColorStop(1, grey(95));
  context.fillStyle = sky;
  context.fillRect(window.x, window.y, window.w, window.h);
  context.fillStyle = grey(215);
  context.beginPath();
  context.moveTo(window.x, window.y + window.h * 0.62);
  for (let i = 0; i <= 12; i += 1) {
    context.lineTo(window.x + (window.w * i) / 12, window.y + window.h * (0.58 + 0.08 * Math.sin(i * 1.7) + 0.03 * rand()));
  }
  context.lineTo(window.x + window.w, window.y + window.h);
  context.lineTo(window.x, window.y + window.h);
  context.fill();
  context.fillStyle = grey(30);
  context.fillRect(window.x + window.w * 0.62, window.y + window.h * 0.3, window.w * 0.05, window.h * 0.32);
  for (let i = 0; i < width * height * 0.08; i += 1) {
    const code = Math.round(rand() * 255);
    context.fillStyle = `rgba(${code},${code},${code},0.16)`;
    context.fillRect(window.x + rand() * window.w, window.y + rand() * window.h, 1.5, 1.5);
  }
  context.fillStyle = grey(30);
  context.font = `${Math.round(width * 0.045)}px "Host Grotesk", sans-serif`;
  context.textBaseline = 'middle';
  context.fillText('KESTREL 400   ▸ 14', rebate, height - (height - window.y - window.h) / 2);
  context.fillText('14A', width - rebate - context.measureText('14A').width, height - (height - window.y - window.h) / 2);
}

function drawWedge(context, width, height) {
  context.fillStyle = grey(0);
  context.fillRect(0, 0, width, height);
  const step = width / 21;
  for (let k = 0; k < 21; k += 1) {
    context.fillStyle = grey(Math.round(250 * 10 ** (-0.04 * k)));
    context.fillRect(Math.floor(k * step), 0, Math.ceil(step), height);
  }
}

function drawBlank(context, width, height) {
  context.fillStyle = grey(0);
  context.fillRect(0, 0, width, height);
  context.fillStyle = grey(170);
  const margin = Math.round(width * 0.04);
  const band = Math.round(height * 0.2);
  context.fillRect(margin, margin, width - margin * 2, height - margin * 2);
  context.fillStyle = grey(0);
  const hole = Math.round(band * 0.38);
  for (let x = margin * 2; x < width - margin * 2 - hole; x += hole * 2) {
    context.fillRect(x, margin + Math.round(band * 0.28), hole, hole);
    context.fillRect(x, height - margin - Math.round(band * 0.28) - hole, hole, hole);
  }
  context.fillRect(margin * 2, margin + band, width - margin * 4, height - margin * 2 - band * 2);
  context.fillStyle = grey(70);
  context.fillRect(margin * 2, margin + band, width - margin * 4, height - margin * 2 - band * 2);
}

/** Paint a procedural print on a canvas laid out by CSS; kind is negative, wedge or blank. */
export function paintProcedural(canvas, kind, seed = 14) {
  const width = canvas.clientWidth || 160;
  const height = canvas.clientHeight || Math.round(width * (kind === 'negative' ? 1.25 : kind === 'wedge' ? 1 : 0.75));
  const context = sizeCanvas(canvas, width, height);
  const painters = { negative: drawNegative, wedge: drawWedge, blank: drawBlank };
  painters[kind](context, canvas.width, canvas.height, seed);
  tintCanvas(context, canvas.width, canvas.height, kind === 'negative' ? 1 : DIM);
}

