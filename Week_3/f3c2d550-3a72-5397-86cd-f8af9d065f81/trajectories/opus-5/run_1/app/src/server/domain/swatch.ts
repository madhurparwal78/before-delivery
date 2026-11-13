import type { UprightImage } from './photo.js';

/** The one place where a swatch is measured and where wide-gamut colour is converted. */

export const DISPLAY_P3_DESCRIPTION = 'Display P3';

export interface PixelArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Rgb = [number, number, number];

/** At capture, the area is the centred rectangle half the upright image's width and height. */
export function computedSwatchArea(width: number, height: number): PixelArea {
  const areaWidth = Math.max(1, Math.floor(width / 2));
  const areaHeight = Math.max(1, Math.floor(height / 2));
  return {
    left: Math.floor((width - areaWidth) / 2),
    top: Math.floor((height - areaHeight) / 2),
    width: areaWidth,
    height: areaHeight,
  };
}

/** For an eyedropper point, the 5 x 5 pixel box centred on it, clipped to the image. */
export function eyedropperArea(width: number, height: number, x: number, y: number): PixelArea {
  const column = Math.round(x * (width - 1));
  const row = Math.round(y * (height - 1));
  const left = Math.max(0, column - 2);
  const top = Math.max(0, row - 2);
  const right = Math.min(width - 1, column + 2);
  const bottom = Math.min(height - 1, row + 2);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** The arithmetic mean of each channel as stored, leaving out fully transparent pixels. */
function meanOverArea(image: UprightImage, area: PixelArea): Rgb {
  let red = 0;
  let green = 0;
  let blue = 0;
  let counted = 0;
  for (let y = area.top; y < area.top + area.height; y += 1) {
    for (let x = area.left; x < area.left + area.width; x += 1) {
      const index = (y * image.width + x) * 4;
      if (image.data[index + 3] === 0) continue;
      red += image.data[index]!;
      green += image.data[index + 1]!;
      blue += image.data[index + 2]!;
      counted += 1;
    }
  }
  if (counted === 0) return [0, 0, 0];
  return [red / counted, green / counted, blue / counted];
}

function linearise(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function encode(linear: number): number {
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
}

const P3_TO_SRGB: readonly Rgb[] = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];

function displayP3ToSrgb(mean: Rgb): Rgb {
  const linear = mean.map((channel) => linearise(channel / 255)) as Rgb;
  return P3_TO_SRGB.map((row) => {
    const value = row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2];
    const clamped = Math.min(1, Math.max(0, value));
    return Math.round(encode(clamped) * 255);
  }) as Rgb;
}

function srgbAsStored(mean: Rgb): Rgb {
  return mean.map((channel) => Math.round(channel)) as Rgb;
}

/**
 * The conversion a photograph's own colour profile calls for. Anything but a profile
 * described as `Display P3` is read as sRGB.
 */
export function srgbConverter(profileDescription: string | null): (mean: Rgb) => Rgb {
  return profileDescription?.trim() === DISPLAY_P3_DESCRIPTION ? displayP3ToSrgb : srgbAsStored;
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** The screen colour of an area of the upright image. */
export function measureSwatch(
  image: UprightImage,
  area: PixelArea,
  convert: (mean: Rgb) => Rgb,
): string {
  return toHex(convert(meanOverArea(image, area)));
}
