/** Procedural vector art for product images, drawn from the product id. */

const PALETTE = ['#1b2ee8', '#0b0b0f', '#ffd400', '#ff2d94', '#00c389'] as const;

function seedOf(text: string): number {
  let seed = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    seed ^= text.charCodeAt(index);
    seed = Math.imul(seed, 16_777_619);
  }
  return seed >>> 0;
}

function nextRandom(state: { seed: number }): number {
  state.seed = (Math.imul(state.seed, 1_664_525) + 1_013_904_223) >>> 0;
  return state.seed / 4_294_967_296;
}

export function productArtSvg(productId: string): string {
  const state = { seed: seedOf(productId) };
  const ground = PALETTE[Math.floor(nextRandom(state) * 2)];
  const shapes: string[] = [];
  const bands = 3 + Math.floor(nextRandom(state) * 3);
  for (let index = 0; index < bands; index += 1) {
    const colour = PALETTE[2 + Math.floor(nextRandom(state) * 3)];
    const width = 120 + Math.floor(nextRandom(state) * 360);
    const height = 40 + Math.floor(nextRandom(state) * 120);
    const x = Math.floor(nextRandom(state) * (600 - width));
    const y = Math.floor(nextRandom(state) * (600 - height));
    shapes.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="28" fill="${colour}"/>`,
    );
  }
  const circles = 2 + Math.floor(nextRandom(state) * 3);
  for (let index = 0; index < circles; index += 1) {
    const colour = PALETTE[Math.floor(nextRandom(state) * PALETTE.length)];
    const radius = 40 + Math.floor(nextRandom(state) * 120);
    const cx = radius + Math.floor(nextRandom(state) * (600 - radius * 2));
    const cy = radius + Math.floor(nextRandom(state) * (600 - radius * 2));
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${colour}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img">
<rect width="600" height="600" fill="${ground}"/>
${shapes.join('\n')}
</svg>`;
}
