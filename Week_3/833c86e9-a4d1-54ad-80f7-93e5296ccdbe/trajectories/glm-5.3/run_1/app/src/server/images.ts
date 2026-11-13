import crypto from "node:crypto";
import { db, s3, storageAvailable } from "./runtime.js";

/** Deterministic pseudo-random generator from a seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashCode(s: string): number {
  const h = crypto.createHash("sha256").update(s).digest();
  return h.readUInt32BE(0);
}

/**
 * Three procedurally drawn pictures per property: a facade, a room and a view.
 * Simple flat shapes only; no external resources.
 */
export function drawPicture(code: string, n: number): string {
  const r = rng(hashCode(code + ":" + n));
  const hue = Math.floor(r() * 360);
  const palette = [`hsl(${hue},35%,28%)`, `hsl(${(hue + 40) % 360},45%,60%)`, `hsl(${hue},20%,85%)`];
  const w = 960, h = 540;
  const parts: string[] = [];
  parts.push(`<rect width="${w}" height="${h}" fill="${palette[2]}"/>`);
  if (n === 0) {
    // facade: rows of windows and a door
    parts.push(`<rect x="80" y="120" width="800" height="420" fill="${palette[0]}"/>`);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        const lit = r() > 0.5;
        parts.push(`<rect x="${140 + col * 120}" y="${170 + row * 110}" width="70" height="80" fill="${lit ? palette[1] : "hsl(45,80%,70%)"}"/>`);
      }
    }
    parts.push(`<rect x="${430}" y="${420}" width="110" height="120" fill="hsl(45,80%,70%)"/>`);
  } else if (n === 1) {
    // room: bed, lamp, rug
    parts.push(`<rect x="60" y="330" width="500" height="90" fill="${palette[0]}"/>`);
    parts.push(`<rect x="80" y="290" width="200" height="50" fill="#fff"/>`);
    parts.push(`<rect x="620" y="180" width="220" height="240" fill="${palette[1]}"/>`);
    parts.push(`<rect x="80" y="450" width="380" height="60" fill="${palette[1]}" opacity="0.5"/>`);
  } else {
    // view: coast and moon
    parts.push(`<circle cx="${180 + r() * 600}" cy="120" r="60" fill="#fff"/>`);
    parts.push(`<path d="M0,360 Q240,300 480,350 T960,330 L960,540 L0,540 Z" fill="${palette[0]}"/>`);
    for (let i = 0; i < 4; i++) {
      parts.push(`<rect x="${80 + r() * 700}" y="${180 + r() * 80}" width="40" height="${140 + r() * 60}" fill="${palette[1]}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${code}"><title>${code} picture ${n + 1}</title>${parts.join("")}</svg>`;
}

let ensured = false;

/** Write the three pictures for every property when missing; retried while storage is down. */
export async function ensurePropertyImages(): Promise<void> {
  if (ensured || !storageAvailable()) return;
  const rows = await db.query("SELECT code FROM properties ORDER BY code");
  for (const row of rows.rows) {
    for (let n = 1; n <= 3; n++) {
      const key = `images/${row.code}/${n}.svg`;
      const existing = await s3.get(key);
      if (!existing) await s3.put(key, Buffer.from(drawPicture(row.code, n - 1), "utf-8"), "image/svg+xml");
    }
  }
  ensured = true;
}

export async function serveImage(code: string, n: number): Promise<Buffer | "unavailable" | null> {
  if (!storageAvailable()) return "unavailable";
  if (n < 1 || n > 3) return null;
  const exists = await db.query("SELECT 1 FROM properties WHERE code = $1", [code]);
  if (!exists.rows[0]) return null;
  try {
    const buf = await s3.get(`images/${code}/${n}.svg`);
    if (buf) return buf;
    // regenerate on demand
    const drawn = Buffer.from(drawPicture(code, n - 1), "utf-8");
    await s3.put(`images/${code}/${n}.svg`, drawn, "image/svg+xml");
    return drawn;
  } catch {
    return "unavailable";
  }
}
