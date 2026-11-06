import * as THREE from 'three';
import { crateTones, palette } from './palette.ts';

export const DISPLAY_FONT = '"Archivo Display", system-ui, sans-serif';

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  return { canvas, context };
}

/** Kraft board with corrugated flutes and a strip of packing tape. */
export function fluteTexture(withTape: boolean): THREE.Texture {
  const { canvas, context } = canvasOf(256, 128);
  context.fillStyle = crateTones.box;
  context.fillRect(0, 0, 256, 128);
  context.strokeStyle = 'rgba(120, 90, 50, 0.35)';
  context.lineWidth = 2;
  for (let x = 4; x < 256; x += 9) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 128);
    context.stroke();
  }
  context.strokeStyle = 'rgba(255, 245, 225, 0.25)';
  context.lineWidth = 1;
  for (let x = 8; x < 256; x += 9) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 128);
    context.stroke();
  }
  if (withTape) {
    context.fillStyle = crateTones.tape;
    context.fillRect(0, 48, 256, 26);
    context.strokeStyle = 'rgba(80, 60, 30, 0.35)';
    context.lineWidth = 1;
    context.strokeRect(0.5, 48.5, 255, 25);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Inked rubber lettering for a stamp, drawn in the display face. */
export function stampTexture(text: string, colour: 'green' | 'ink'): THREE.Texture {
  const { canvas, context } = canvasOf(512, 256);
  context.clearRect(0, 0, 512, 256);
  context.save();
  context.translate(256, 128);
  context.rotate(-0.05);
  context.font = `800 ${text.length > 7 ? 74 : 92}px ${DISPLAY_FONT}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = colour === 'green' ? palette.green : palette.ink;
  context.globalAlpha = 0.92;
  context.fillText(text, 0, 0);
  context.globalAlpha = 0.35;
  context.fillText(text, 1.5, -1.5);
  context.restore();
  context.globalAlpha = 1;
  context.strokeStyle = colour === 'green' ? palette.green : palette.ink;
  context.lineWidth = 7;
  context.strokeRect(28, 56, 456, 144);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
