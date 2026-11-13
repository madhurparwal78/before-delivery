import { query } from './db';
import { objectExists, putObject } from './storage';

function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(state: { value: number }): number {
  state.value = (state.value * 1664525 + 1013904223) >>> 0;
  return state.value / 4294967296;
}

/** A drawn picture: invented harbour shapes, no photography. */
export function pictureSvg(propertyCode: string, index: number): string {
  const state = { value: seedOf(`${propertyCode}#${index}`) };
  const width = 1200;
  const height = 800;
  const horizon = 420 + Math.floor(random(state) * 80);
  const parts: string[] = [];
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<rect y="${horizon}" width="${width}" height="${height - horizon}" fill="#0a0a0a"/>`);
  const sunRadius = 60 + Math.floor(random(state) * 90);
  const sunX = 150 + Math.floor(random(state) * 900);
  parts.push(`<circle cx="${sunX}" cy="${horizon - sunRadius - 40}" r="${sunRadius}" fill="#ff5a00"/>`);
  let x = 0;
  while (x < width) {
    const w = 40 + Math.floor(random(state) * 120);
    const h = 60 + Math.floor(random(state) * 260);
    const fill = random(state) > 0.5 ? '#0a0a0a' : '#b7c9ad';
    parts.push(`<rect x="${x}" y="${horizon - h}" width="${w}" height="${h}" fill="${fill}"/>`);
    if (random(state) > 0.6) {
      parts.push(
        `<rect x="${x + Math.floor(w / 3)}" y="${horizon - h - 40}" width="${Math.max(
          6,
          Math.floor(w / 6),
        )}" height="40" fill="#0a0a0a"/>`,
      );
    }
    x += w + 6 + Math.floor(random(state) * 24);
  }
  for (let i = 0; i < 9; i++) {
    const lx = Math.floor(random(state) * width);
    const ly = horizon + 30 + Math.floor(random(state) * (height - horizon - 60));
    const lw = 60 + Math.floor(random(state) * 220);
    parts.push(`<rect x="${lx}" y="${ly}" width="${lw}" height="6" fill="#f2f0ea" opacity="0.85"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><title>${propertyCode} ${index}</title>${parts.join(
    '',
  )}</svg>`;
}

export function pictureKey(propertyCode: string, index: number): string {
  return `images/${propertyCode}/${index}.svg`;
}

/** Writes the three pictures of every property when missing, retrying while storage is down. */
export async function ensurePictures(): Promise<void> {
  const properties = await query<{ code: string }>('select code from properties order by code');
  for (const property of properties) {
    for (let index = 1; index <= 3; index++) {
      const key = pictureKey(property.code, index);
      if (await objectExists(key)) continue;
      await putObject(key, Buffer.from(pictureSvg(property.code, index), 'utf8'), 'image/svg+xml');
    }
  }
}

export function startPictureWriter(): void {
  const attempt = async (): Promise<void> => {
    try {
      await ensurePictures();
    } catch {
      setTimeout(() => void attempt(), 5000);
    }
  };
  void attempt();
}
