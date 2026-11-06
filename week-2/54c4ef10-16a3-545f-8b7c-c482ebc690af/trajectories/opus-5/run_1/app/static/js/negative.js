// The negative tint: the only place a preview code becomes a screen colour.
export const GROUND = [19, 54, 33];
export const INK = [244, 217, 108];
export const PROCEDURAL_BRIGHTNESS = 0.7;

export function tintCode(code, brightness = 1) {
  return GROUND.map((ground, channel) => {
    const value = Math.round(ground + ((INK[channel] - ground) * code) / 255);
    return Math.round(value * brightness);
  });
}

export function palette(brightness = 1) {
  const table = new Uint8ClampedArray(256 * 3);
  for (let code = 0; code < 256; code += 1) {
    const [r, g, b] = tintCode(code, brightness);
    table[code * 3] = r;
    table[code * 3 + 1] = g;
    table[code * 3 + 2] = b;
  }
  return table;
}

const DEFAULT_PALETTE = palette();

// Preview pixels arrive as greyscale; every channel holds the same code.
export function tintImageData(image, brightness = 1) {
  const table = brightness === 1 ? DEFAULT_PALETTE : palette(brightness);
  const { data } = image;
  for (let index = 0; index < data.length; index += 4) {
    const code = data[index];
    data[index] = table[code * 3];
    data[index + 1] = table[code * 3 + 1];
    data[index + 2] = table[code * 3 + 2];
    data[index + 3] = 255;
  }
  return image;
}

export function tintCanvas(canvas, brightness = 1) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  context.putImageData(tintImageData(image, brightness), 0, 0);
}

export function groundColour() {
  return `rgb(${GROUND.join(',')})`;
}

export function inkColour() {
  return `rgb(${INK.join(',')})`;
}

export function codeColour(code, brightness = 1) {
  return `rgb(${tintCode(code, brightness).join(',')})`;
}
