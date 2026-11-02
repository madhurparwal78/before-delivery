import { type FlavourSlug, findFlavour } from '../../../shared/catalogue.js';

export interface CanPalette {
  base: string;
  band: string | null;
  ink: string;
}

const PALETTES: Readonly<Record<FlavourSlug, CanPalette>> = {
  'guava-lime': { base: '#e2567f', band: '#a9d13c', ink: '#2c0a16' },
  'yuzu-ginger': { base: '#e8bb2e', band: null, ink: '#2e2305' },
  'passionfruit-basil': { base: '#7b4ea8', band: null, ink: '#f7f0ff' },
  'cacao-orange': { base: '#4a2c1a', band: '#e8762c', ink: '#fbe8d6' },
};

export function canPalette(flavour: FlavourSlug): CanPalette {
  return PALETTES[flavour];
}

/** A seeded pseudo-random stream, so the same drawing is produced every time. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function drawMateLeaf(
  ctx: CanvasRenderingContext2D,
  length: number,
  colour: string,
  veinColour: string,
): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * 0.4, -length * 0.3, length, 0);
  ctx.quadraticCurveTo(length * 0.4, length * 0.3, 0, 0);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = veinColour;
  ctx.lineWidth = Math.max(1, length * 0.03);
  ctx.beginPath();
  ctx.moveTo(length * 0.08, 0);
  ctx.lineTo(length * 0.92, 0);
  ctx.stroke();
}

function drawBlossom(ctx: CanvasRenderingContext2D, radius: number, colour: string): void {
  ctx.fillStyle = colour;
  for (let petal = 0; petal < 5; petal += 1) {
    ctx.save();
    ctx.rotate((petal * Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(radius * 0.6, 0, radius * 0.6, radius * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = '#f7e6a1';
  ctx.fill();
}

/**
 * Draws the can's wrap-around label: the flavour's colour, its band, the Ceibo
 * wordmark and a ring of mate leaves. Everything is generated here in code.
 */
export function drawCanLabel(
  ctx: CanvasRenderingContext2D,
  flavour: FlavourSlug,
  width: number,
  height: number,
): void {
  const palette = canPalette(flavour);
  const name = findFlavour(flavour)?.name ?? '';

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, width, height);

  // Brushed aluminium top and bottom rims.
  const rim = ctx.createLinearGradient(0, 0, 0, height * 0.08);
  rim.addColorStop(0, '#e8e4dc');
  rim.addColorStop(1, '#b9b4aa');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, width, height * 0.06);
  ctx.fillRect(0, height * 0.94, width, height * 0.06);

  if (palette.band !== null) {
    ctx.fillStyle = palette.band;
    ctx.fillRect(0, height * 0.72, width, height * 0.1);
  }

  // A ring of mate leaves, placed by a seeded pattern.
  const random = seededRandom(flavour.length * 7919 + 104_729);
  for (let index = 0; index < 28; index += 1) {
    ctx.save();
    ctx.translate(random() * width, height * (0.16 + random() * 0.1));
    ctx.rotate((random() - 0.5) * 1.4);
    ctx.globalAlpha = 0.28 + random() * 0.2;
    drawMateLeaf(ctx, height * (0.07 + random() * 0.05), palette.ink, palette.base);
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let repeat = 0; repeat < 2; repeat += 1) {
    const centre = width * (repeat / 2 + 0.25);
    ctx.save();
    ctx.translate(centre, height * 0.42);
    ctx.font = `600 ${Math.round(height * 0.13)}px Fraunces, Georgia, serif`;
    ctx.fillText('Ceibo', 0, 0);
    ctx.font = `400 ${Math.round(height * 0.042)}px "Atkinson Hyperlegible", sans-serif`;
    ctx.fillText(name.toUpperCase(), 0, height * 0.12);
    ctx.fillText('SPARKLING YERBA MATE', 0, height * 0.185);
    ctx.restore();

    ctx.save();
    ctx.translate(centre, height * 0.88);
    drawBlossom(ctx, height * 0.04, '#f2566b');
    ctx.restore();
  }
}

/**
 * The still fallback: a layered drawing of the can, with its label artwork slid
 * sideways to suggest the rotation.
 */
export function drawLayeredCan(
  ctx: CanvasRenderingContext2D,
  flavour: FlavourSlug,
  angleDegrees: number,
  width: number,
  height: number,
): void {
  const palette = canPalette(flavour);
  const bodyWidth = Math.min(width * 0.46, height * 0.34);
  const bodyHeight = bodyWidth * 2.5;
  const left = (width - bodyWidth) / 2;
  const top = (height - bodyHeight) / 2;
  const name = findFlavour(flavour)?.name ?? '';

  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(width / 2, top + bodyHeight + bodyWidth * 0.1, bodyWidth * 0.62, bodyWidth * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const body = ctx.createLinearGradient(left, 0, left + bodyWidth, 0);
  body.addColorStop(0, 'rgba(0,0,0,0.42)');
  body.addColorStop(0.35, 'rgba(255,255,255,0.08)');
  body.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  body.addColorStop(1, 'rgba(0,0,0,0.38)');

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left, top + bodyWidth * 0.16);
  ctx.lineTo(left, top + bodyHeight - bodyWidth * 0.16);
  ctx.ellipse(
    width / 2,
    top + bodyHeight - bodyWidth * 0.16,
    bodyWidth / 2,
    bodyWidth * 0.16,
    0,
    Math.PI,
    0,
    true,
  );
  ctx.lineTo(left + bodyWidth, top + bodyWidth * 0.16);
  ctx.ellipse(width / 2, top + bodyWidth * 0.16, bodyWidth / 2, bodyWidth * 0.16, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = palette.base;
  ctx.fillRect(left, top, bodyWidth, bodyHeight);

  // The label slides sideways in the turn's direction, wrapping around the can.
  const offset = ((angleDegrees % 360) / 360) * bodyWidth;
  ctx.save();
  ctx.translate(-offset, 0);
  for (const repeat of [0, 1]) {
    const centre = left + bodyWidth * 0.5 + repeat * bodyWidth;
    if (palette.band !== null) {
      ctx.fillStyle = palette.band;
      ctx.fillRect(centre - bodyWidth / 2, top + bodyHeight * 0.72, bodyWidth, bodyHeight * 0.08);
    }
    ctx.fillStyle = palette.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(bodyWidth * 0.3)}px Fraunces, Georgia, serif`;
    ctx.fillText('Ceibo', centre, top + bodyHeight * 0.42);
    ctx.font = `400 ${Math.round(bodyWidth * 0.1)}px "Atkinson Hyperlegible", sans-serif`;
    ctx.fillText(name.toUpperCase(), centre, top + bodyHeight * 0.54);
    ctx.save();
    ctx.translate(centre, top + bodyHeight * 0.86);
    drawBlossom(ctx, bodyWidth * 0.1, '#f2566b');
    ctx.restore();
  }
  ctx.restore();

  ctx.fillStyle = body;
  ctx.fillRect(left, top, bodyWidth, bodyHeight);
  ctx.restore();

  const lidGradient = ctx.createLinearGradient(left, 0, left + bodyWidth, 0);
  lidGradient.addColorStop(0, '#9c978d');
  lidGradient.addColorStop(0.5, '#efebe3');
  lidGradient.addColorStop(1, '#8d8880');
  ctx.fillStyle = lidGradient;
  ctx.beginPath();
  ctx.ellipse(width / 2, top + bodyWidth * 0.16, bodyWidth / 2, bodyWidth * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = Math.max(1, bodyWidth * 0.02);
  ctx.stroke();
}
