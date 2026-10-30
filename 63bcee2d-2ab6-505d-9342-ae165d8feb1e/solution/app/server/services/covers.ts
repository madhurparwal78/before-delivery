import { createHash } from "node:crypto";

// Procedural case-study covers (brief: Imagery and icons): a drafted interior elevation drawn from the
// slug, so every case study has its own deterministic picture in the five palette roles.

const PLASTER = "#EFEBE2";
const INK = "#191A17";
const GREEN_BLACK = "#1F211E";
const OXIDE = "#B6462A";
const SAGE = "#5F6B55";

/** A deterministic stream of numbers in [0, 1) seeded by the slug. */
function stream(seed: string): () => number {
  let state = createHash("sha256").update(seed).digest();
  let index = 0;
  return () => {
    if (index + 4 > state.length) {
      state = createHash("sha256").update(state).digest();
      index = 0;
    }
    const value = state.readUInt32BE(index) / 2 ** 32;
    index += 4;
    return value;
  };
}

const round = (n: number): string => n.toFixed(1);

export function coverSvg(slug: string, sector: string): string {
  const next = stream(slug);
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)];
  const W = 1600;
  const H = 1000;
  const floor = 780 + Math.floor(next() * 60);
  const ceiling = 150 + Math.floor(next() * 50);
  const accent = pick([OXIDE, SAGE]);
  const dark = next() > 0.5;
  const ground = dark ? GREEN_BLACK : PLASTER;
  const line = dark ? PLASTER : INK;
  const parts: string[] = [];

  // Drafting grid and the room's section: ceiling, floor and back wall.
  for (let x = 80; x < W; x += 80) parts.push(`<path d="M${x} 0V${H}" stroke="${line}" stroke-opacity="0.08"/>`);
  for (let y = 80; y < H; y += 80) parts.push(`<path d="M0 ${y}H${W}" stroke="${line}" stroke-opacity="0.08"/>`);
  parts.push(`<rect x="0" y="${floor}" width="${W}" height="${H - floor}" fill="${line}" fill-opacity="0.06"/>`);
  parts.push(`<path d="M0 ${ceiling}H${W}M0 ${floor}H${W}" stroke="${line}" stroke-width="3"/>`);

  // Floor tiles in perspective toward a vanishing point.
  const vx = 500 + next() * 600;
  for (let i = -6; i <= 14; i++) {
    const x = i * 130;
    parts.push(`<path d="M${round(vx + (x - vx) * 0.35)} ${floor}L${x} ${H}" stroke="${line}" stroke-opacity="0.18"/>`);
  }

  // A feature wall: panels with one accent panel.
  const bays = 4 + Math.floor(next() * 4);
  const bayWidth = (W - 240) / bays;
  const accentBay = Math.floor(next() * bays);
  for (let b = 0; b < bays; b++) {
    const x = 120 + b * bayWidth;
    parts.push(`<rect x="${round(x + 10)}" y="${ceiling + 40}" width="${round(bayWidth - 20)}" height="${floor - ceiling - 260}"
      fill="${b === accentBay ? accent : "none"}" fill-opacity="${b === accentBay ? 0.85 : 0}" stroke="${line}" stroke-width="2"/>`);
  }

  if (sector === "food_beverage") {
    // Counter, stools and pendant lamps.
    const cx = 260 + next() * 300;
    const cw = 620 + next() * 260;
    parts.push(`<rect x="${round(cx)}" y="${floor - 210}" width="${round(cw)}" height="210" fill="${ground}" stroke="${line}" stroke-width="3"/>`);
    parts.push(`<rect x="${round(cx - 20)}" y="${floor - 226}" width="${round(cw + 40)}" height="16" fill="${line}"/>`);
    for (let s = 0; s < 5; s++) {
      const sx = cx + 60 + s * (cw - 120) / 4;
      parts.push(`<path d="M${round(sx - 30)} ${floor - 120}H${round(sx + 30)}M${round(sx)} ${floor - 120}V${floor}M${round(sx - 26)} ${floor}H${round(sx + 26)}" stroke="${line}" stroke-width="3"/>`);
      parts.push(`<path d="M${round(sx)} ${ceiling}V${ceiling + 160}" stroke="${line}" stroke-width="2"/>`);
      parts.push(`<path d="M${round(sx - 34)} ${ceiling + 200}Q${round(sx)} ${ceiling + 140} ${round(sx + 34)} ${ceiling + 200}Z" fill="${accent}" stroke="${line}" stroke-width="2"/>`);
    }
  } else if (sector === "retail") {
    // Display shelving with objects and a low plinth.
    const shelves = 3 + Math.floor(next() * 2);
    for (let r = 0; r < shelves; r++) {
      const y = ceiling + 110 + r * 110;
      parts.push(`<path d="M160 ${y}H${W - 160}" stroke="${line}" stroke-width="4"/>`);
      for (let o = 0; o < 9; o++) {
        const ox = 200 + o * 140 + next() * 40;
        const oh = 30 + next() * 50;
        parts.push(`<rect x="${round(ox)}" y="${round(y - oh)}" width="${round(36 + next() * 30)}" height="${round(oh)}" fill="${next() > 0.75 ? accent : "none"}" stroke="${line}" stroke-width="2"/>`);
      }
    }
    const px = 480 + next() * 300;
    parts.push(`<rect x="${round(px)}" y="${floor - 120}" width="520" height="120" fill="${ground}" stroke="${line}" stroke-width="3"/>`);
  } else {
    // Workplace: desks and task chairs, a stair rising to the right.
    for (let d = 0; d < 4; d++) {
      const dx = 180 + d * 280;
      parts.push(`<path d="M${dx} ${floor - 150}H${dx + 220}M${dx + 20} ${floor - 150}V${floor}M${dx + 200} ${floor - 150}V${floor}" stroke="${line}" stroke-width="3"/>`);
      parts.push(`<rect x="${dx + 70}" y="${floor - 240}" width="90" height="70" fill="none" stroke="${line}" stroke-width="2"/>`);
    }
    let sx = 1320;
    let sy = floor;
    const steps: string[] = [`M${sx} ${sy}`];
    for (let s = 0; s < 9; s++) {
      sy -= 48;
      steps.push(`V${sy}`);
      sx += 22;
      steps.push(`H${sx}`);
    }
    parts.push(`<path d="${steps.join("")}" fill="none" stroke="${accent}" stroke-width="5"/>`);
  }

  // Title-block strip along the foot, as on a drawing sheet.
  parts.push(`<rect x="40" y="${H - 64}" width="${W - 80}" height="40" fill="none" stroke="${line}" stroke-width="2"/>`);
  for (const x of [360, 760, 1160]) parts.push(`<path d="M${x} ${H - 64}V${H - 24}" stroke="${line}" stroke-width="2"/>`);
  parts.push(`<rect x="1180" y="${H - 54}" width="${round(80 + next() * 300)}" height="20" fill="${accent}"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    `<rect width="${W}" height="${H}" fill="${ground}"/>${parts.join("")}` +
    `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="${line}" stroke-width="2"/></svg>`;
}
