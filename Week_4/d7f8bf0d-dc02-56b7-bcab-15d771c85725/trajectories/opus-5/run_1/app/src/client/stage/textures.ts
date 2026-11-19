import * as THREE from 'three';
import type { BlockState } from '../../shared/protocol.js';

const PALETTE = {
  field: '#35a84a',
  fieldDeep: '#1f7733',
  accent: '#38a9ef',
  accentDeep: '#1b3a94',
  action: '#f5811f',
  actionDeep: '#c25c06',
  ink: '#1b2240',
  inkLight: '#52597c',
} as const;

function surface(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D drawing surface is needed for the stage textures');
  return context;
}

function toTexture(context: CanvasRenderingContext2D, repeat: number): THREE.Texture {
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Block states drawn as pattern, never colour alone: plain, chevrons, train glyph, hatching. */
export function blockStateTexture(state: BlockState): THREE.Texture {
  const context = surface(64, 64);
  if (state === 'free') {
    context.fillStyle = PALETTE.field;
    context.fillRect(0, 0, 64, 64);
    context.strokeStyle = PALETTE.fieldDeep;
    context.lineWidth = 3;
    context.strokeRect(1.5, 1.5, 61, 61);
  }
  if (state === 'reserved') {
    context.fillStyle = PALETTE.accent;
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = PALETTE.accentDeep;
    for (let offset = -64; offset < 128; offset += 32) {
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset + 18, 32);
      context.lineTo(offset, 64);
      context.lineTo(offset + 8, 64);
      context.lineTo(offset + 26, 32);
      context.lineTo(offset + 8, 0);
      context.closePath();
      context.fill();
    }
  }
  if (state === 'occupied') {
    context.fillStyle = PALETTE.action;
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = PALETTE.ink;
    context.fillRect(14, 22, 36, 18);
    context.fillRect(20, 14, 18, 8);
    context.beginPath();
    context.arc(22, 44, 5, 0, Math.PI * 2);
    context.arc(42, 44, 5, 0, Math.PI * 2);
    context.fill();
  }
  if (state === 'out_of_service') {
    context.fillStyle = PALETTE.ink;
    context.fillRect(0, 0, 64, 64);
    context.strokeStyle = PALETTE.inkLight;
    context.lineWidth = 7;
    for (let offset = -64; offset < 128; offset += 18) {
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset + 64, 64);
      context.stroke();
    }
  }
  return toTexture(context, 6);
}

export function ribbonTexture(): THREE.Texture {
  const context = surface(64, 64);
  context.fillStyle = PALETTE.accent;
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = '#ffffff';
  for (let offset = -64; offset < 128; offset += 26) {
    context.beginPath();
    context.moveTo(offset, 8);
    context.lineTo(offset + 16, 32);
    context.lineTo(offset, 56);
    context.lineTo(offset + 7, 56);
    context.lineTo(offset + 23, 32);
    context.lineTo(offset + 7, 8);
    context.closePath();
    context.fill();
  }
  return toTexture(context, 4);
}

/** A station name board drawn to a canvas, so no artwork is imported. */
export function labelTexture(text: string): THREE.Texture {
  const context = surface(512, 128);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 512, 128);
  context.strokeStyle = PALETTE.accentDeep;
  context.lineWidth = 10;
  context.strokeRect(5, 5, 502, 118);
  context.fillStyle = PALETTE.ink;
  context.font = '600 56px Fredoka, Trebuchet MS, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 68, 470);
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function roofTexture(): THREE.Texture {
  const context = surface(16, 256);
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#f4f7ff');
  gradient.addColorStop(0.55, '#dde6f8');
  gradient.addColorStop(1, '#c6d4ee');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 16, 256);
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const stagePalette = PALETTE;
