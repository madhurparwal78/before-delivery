import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/** Pale wood-toned floor planks painted in code. Deterministic, so every page draws the same floor. */
export function createFloorTexture(columns: number, rows: number): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const plankHeight = size / 8;
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let plank = 0; plank < 8; plank += 1) {
      const lightness = 76 + random() * 6;
      context.fillStyle = `hsl(35 42% ${lightness}%)`;
      context.fillRect(0, plank * plankHeight, size, plankHeight);
      let x = random() * 160;
      while (x < size) {
        context.fillStyle = 'rgba(120, 84, 48, 0.28)';
        context.fillRect(x, plank * plankHeight, 2, plankHeight);
        x += 200 + random() * 120;
      }
      context.fillStyle = 'rgba(120, 84, 48, 0.12)';
      for (let grain = 0; grain < 5; grain += 1) {
        context.fillRect(random() * size, plank * plankHeight + 6 + random() * (plankHeight - 12), 60 + random() * 120, 1.5);
      }
      context.fillStyle = 'rgba(110, 76, 44, 0.4)';
      context.fillRect(0, plank * plankHeight, size, 2);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(columns / 4, rows / 4);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A soft warm pool of light, brightest at the centre, for the spotlit seat. */
export function createGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 214, 128, 0.95)');
    gradient.addColorStop(0.55, 'rgba(255, 205, 120, 0.55)');
    gradient.addColorStop(1, 'rgba(255, 200, 110, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
