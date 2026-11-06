// Procedural prints: the hero negative, the step wedge and the blank frame.
// All three are dimmed, so a real negative always outshines them.
import { PROCEDURAL_BRIGHTNESS, codeColour, tintImageData } from './negative.js';

function grainField(width, height, seed) {
  const image = new ImageData(width, height);
  let state = seed;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      state = (state * 1664525 + 1013904223) % 4294967296;
      const noise = (state / 4294967296) * 26 - 13;
      const shade = 150 - (y / height) * 70 + Math.sin(x / 36) * 14 + noise;
      const code = Math.max(0, Math.min(255, Math.round(shade)));
      const index = (y * width + x) * 4;
      image.data[index] = code;
      image.data[index + 1] = code;
      image.data[index + 2] = code;
      image.data[index + 3] = 255;
    }
  }
  return image;
}

export function drawNegativePrint(canvas, edgeNumber = 23) {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.putImageData(
    tintImageData(grainField(width, height, 20240219), PROCEDURAL_BRIGHTNESS),
    0,
    0,
  );
  const margin = Math.round(width * 0.1);
  context.fillStyle = codeColour(18, PROCEDURAL_BRIGHTNESS);
  context.fillRect(0, 0, width, margin);
  context.fillRect(0, height - margin, width, margin);
  const holeSize = Math.round(margin * 0.46);
  context.fillStyle = codeColour(236, PROCEDURAL_BRIGHTNESS);
  for (let x = margin * 0.4; x < width - holeSize; x += holeSize * 2.1) {
    context.fillRect(Math.round(x), Math.round(margin * 0.27), holeSize, holeSize);
    context.fillRect(
      Math.round(x),
      Math.round(height - margin + margin * 0.27),
      holeSize,
      holeSize,
    );
  }
  context.fillStyle = codeColour(230, PROCEDURAL_BRIGHTNESS);
  context.font = `${Math.round(margin * 0.62)}px "Host Grotesk", sans-serif`;
  context.textBaseline = 'middle';
  context.fillText(`${edgeNumber}`, Math.round(width * 0.06), Math.round(height - margin * 0.5));
  context.fillText('KESTREL 400', Math.round(width * 0.2), Math.round(margin * 0.5));
}

export function drawStepWedge(canvas) {
  const context = canvas.getContext('2d');
  const steps = 21;
  const width = canvas.width;
  const height = canvas.height;
  for (let k = 0; k < steps; k += 1) {
    const start = Math.floor((k * width) / steps);
    const stop = Math.floor(((k + 1) * width) / steps);
    const code = Math.round(255 * 10 ** (-(0.05 + 0.15 * k)));
    context.fillStyle = codeColour(code, PROCEDURAL_BRIGHTNESS);
    context.fillRect(start, 0, stop - start, height);
  }
}

export function drawBlankFrame(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const width = canvas.width;
  const height = canvas.height;
  context.putImageData(
    tintImageData(grainField(width, height, 7771), PROCEDURAL_BRIGHTNESS),
    0,
    0,
  );
  context.fillStyle = codeColour(20, PROCEDURAL_BRIGHTNESS);
  const margin = Math.max(4, Math.round(height * 0.12));
  context.fillRect(0, 0, width, margin);
  context.fillRect(0, height - margin, width, margin);
}
