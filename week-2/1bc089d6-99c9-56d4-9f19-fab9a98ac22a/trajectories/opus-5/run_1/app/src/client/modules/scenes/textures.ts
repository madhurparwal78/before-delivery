import * as THREE from 'three';

/** Every texture is drawn by the app on a canvas; no image files are loaded for the scenes. */

export interface SceneTextures {
  glow: THREE.CanvasTexture;
  stars: THREE.CanvasTexture;
  moon: THREE.CanvasTexture;
  paper: THREE.CanvasTexture;
}

const textures: Partial<SceneTextures> = {};

function canvas(size: number): CanvasRenderingContext2D {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  const context = element.getContext('2d');
  if (!context) throw new Error('no 2d context');
  return context;
}

const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

function drawGlow(): THREE.CanvasTexture {
  const context = canvas(256);
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,214,170,0.85)');
  gradient.addColorStop(0.45, 'rgba(255,138,61,0.32)');
  gradient.addColorStop(1, 'rgba(255,138,61,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(context.canvas);
}

function drawStars(): THREE.CanvasTexture {
  const context = canvas(1024);
  const next = random(20261105);
  context.clearRect(0, 0, 1024, 1024);
  for (let i = 0; i < 900; i += 1) {
    const x = next() * 1024;
    const y = next() * 1024;
    const radius = next() * 1.3 + 0.2;
    const alpha = 0.25 + next() * 0.75;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(245,238,230,${alpha.toFixed(2)})`;
    context.fill();
  }
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function drawMoon(): THREE.CanvasTexture {
  const context = canvas(512);
  context.fillStyle = '#e8e2d6';
  context.fillRect(0, 0, 512, 512);
  const next = random(777);
  for (let i = 0; i < 160; i += 1) {
    const x = next() * 512;
    const y = next() * 512;
    const radius = 3 + next() * 26;
    const shade = 0.06 + next() * 0.12;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(90,82,100,${shade})`);
    gradient.addColorStop(0.75, `rgba(120,112,126,${shade * 0.6})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawPaper(): THREE.CanvasTexture {
  const context = canvas(256);
  context.fillStyle = '#f0e2cf';
  context.fillRect(0, 0, 256, 256);
  const next = random(4242);
  for (let i = 0; i < 2600; i += 1) {
    const x = next() * 256;
    const y = next() * 256;
    context.fillStyle = `rgba(120,96,70,${(next() * 0.09).toFixed(3)})`;
    context.fillRect(x, y, 1 + next() * 2, 1);
  }
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const builders: Record<keyof SceneTextures, () => THREE.CanvasTexture> = {
  glow: drawGlow,
  stars: drawStars,
  moon: drawMoon,
  paper: drawPaper,
};

export const textureNames = Object.keys(builders) as (keyof SceneTextures)[];

export function drawTexture(name: keyof SceneTextures): void {
  textures[name] = builders[name]();
}

export function sceneTextures(): SceneTextures {
  for (const name of textureNames) {
    if (!textures[name]) drawTexture(name);
  }
  return textures as SceneTextures;
}
