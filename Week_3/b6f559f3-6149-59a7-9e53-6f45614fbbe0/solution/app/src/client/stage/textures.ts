/** Matcaps and environment maps generated in code: nothing here is a file. */
import { CanvasTexture, EquirectangularReflectionMapping, SRGBColorSpace } from 'three';

const MATCAP_STOPS: Record<string, [number, string][]> = {
  Clay: [
    [0, '#f4e6dc'],
    [0.35, '#c99d84'],
    [0.75, '#7a5644'],
    [1, '#2b1b15'],
  ],
  Chrome: [
    [0, '#ffffff'],
    [0.3, '#aeb4d6'],
    [0.7, '#4a4f6e'],
    [1, '#10111c'],
  ],
  Jade: [
    [0, '#d9f6e6'],
    [0.35, '#59b995'],
    [0.75, '#1d6b52'],
    [1, '#06241b'],
  ],
  Ember: [
    [0, '#ffe3b5'],
    [0.35, '#ff8a3d'],
    [0.75, '#a3260f'],
    [1, '#2b0705'],
  ],
};

const matcaps = new Map<string, CanvasTexture>();
const environments = new Map<string, CanvasTexture>();

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d') as CanvasRenderingContext2D];
}

export function matcapTexture(name: string): CanvasTexture {
  let texture = matcaps.get(name);
  if (!texture) {
    const [element, ctx] = canvas(128, 128);
    const gradient = ctx.createRadialGradient(46, 40, 4, 64, 64, 66);
    for (const [at, colour] of MATCAP_STOPS[name] ?? MATCAP_STOPS['Clay']!) gradient.addColorStop(at, colour);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    if (name === 'Chrome') {
      ctx.fillStyle = 'rgba(8, 9, 20, 0.55)';
      ctx.fillRect(0, 66, 128, 62);
      ctx.fillStyle = 'rgba(190, 200, 255, 0.35)';
      ctx.fillRect(0, 60, 128, 4);
    }
    texture = new CanvasTexture(element);
    texture.colorSpace = SRGBColorSpace;
    matcaps.set(name, texture);
  }
  return texture;
}

export function environmentTexture(name: string): CanvasTexture {
  let texture = environments.get(name);
  if (!texture) {
    const [element, ctx] = canvas(256, 128);
    const sky = ctx.createLinearGradient(0, 0, 0, 128);
    if (name === 'Dusk room') {
      sky.addColorStop(0, '#4a3a7a');
      sky.addColorStop(0.5, '#c28a7a');
      sky.addColorStop(1, '#2a2030');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#ffd9a8';
      ctx.fillRect(40, 30, 48, 36);
      ctx.fillRect(170, 36, 36, 28);
    } else if (name === 'Night grid') {
      sky.addColorStop(0, '#0d0d24');
      sky.addColorStop(0.5, '#2a2260');
      sky.addColorStop(1, '#07070f');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = '#8e6cf2';
      ctx.lineWidth = 1;
      for (let x = 0; x <= 256; x += 16) {
        ctx.moveTo(x, 64);
        ctx.lineTo(x, 128);
      }
      for (let y = 64; y <= 128; y += 8) {
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
      }
      ctx.stroke();
    } else {
      sky.addColorStop(0, '#3a3a46');
      sky.addColorStop(1, '#16161c');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 256, 128);
    }
    texture = new CanvasTexture(element);
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = SRGBColorSpace;
    environments.set(name, texture);
  }
  return texture;
}

/** Base colour a matcap shows in the 2D fallback, where there is no texture lookup. */
export const MATCAP_BASE: Record<string, [number, number, number]> = {
  Clay: [201, 157, 132],
  Chrome: [174, 180, 214],
  Jade: [89, 185, 149],
  Ember: [255, 138, 61],
};
