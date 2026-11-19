/** Procedural dot-grain drawings of chairs, grounds and hides (no images from outside). */

const grain = (w: number, h: number, seed: number, density: number, fill: string, radius = 0.6): string => {
  let out = "";
  let x = 7 + (seed * 13) % 11;
  let y = 7 + (seed * 7) % 11;
  const step = Math.max(6, 22 - density * 2);
  while (y < h - 4) {
    x += step;
    if (x >= w - 4) {
      x = 7 + ((x - (w - 4)) % step);
      y += step;
    }
    const jitter = ((x * seed + y * 31) % 5) - 2;
    out += `<circle cx="${x.toFixed(1)}" cy="${(y + jitter).toFixed(1)}" r="${radius}" fill="${fill}" opacity="0.5"/>`;
  }
  return out;
};

/** One chair drawing from a dot primitive, distinct per kind; no leather colour anywhere. */
export function chairDrawing(kind: "bentwood" | "tubular" | "swivel" | "folding" | "cantilever" | "slat" | "lounge", w = 220, h = 200): string {
  const ink = "#3a3a3a";
  const mute = "#8f8f8f";
  const g = grain(w, h, kind.length + 3, 6, mute);
  let shape = "";
  switch (kind) {
    case "bentwood":
      shape = `
        <path d="M60 40 C60 18, 160 18, 160 40" fill="none" stroke="${ink}" stroke-width="6"/>
        <path d="M70 34 C70 80, 150 80, 150 34" fill="none" stroke="${ink}" stroke-width="4"/>
        <rect x="52" y="96" width="116" height="18" rx="9" fill="none" stroke="${ink}" stroke-width="4"/>
        <rect x="60" y="114" width="100" height="14" rx="7" fill="none" stroke="${ink}" stroke-width="4"/>
        <path d="M66 128 L58 184 M124 128 L132 184" stroke="${ink}" stroke-width="4" fill="none"/>`;
      break;
    case "tubular":
      shape = `
        <path d="M70 60 C70 30, 150 30, 150 60 L150 130" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>
        <rect x="66" y="92" width="88" height="20" rx="10" fill="none" stroke="${ink}" stroke-width="4"/>
        <rect x="64" y="120" width="92" height="16" rx="8" fill="none" stroke="${ink}" stroke-width="4"/>
        <path d="M70 136 L70 186 M148 136 L148 186" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
      break;
    case "swivel":
      shape = `
        <rect x="66" y="34" width="88" height="70" rx="12" fill="none" stroke="${ink}" stroke-width="4"/>
        <rect x="60" y="104" width="100" height="20" rx="10" fill="none" stroke="${ink}" stroke-width="4"/>
        <path d="M110 124 L110 156 M70 166 L150 166" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>
        <path d="M96 176 L96 190 M124 176 L124 190" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`;
      break;
    case "folding":
      shape = `
        <path d="M50 60 L110 96 L170 60" fill="none" stroke="${ink}" stroke-width="5"/>
        <rect x="54" y="72" width="112" height="20" rx="8" fill="none" stroke="${ink}" stroke-width="4" transform="rotate(-8 110 82)"/>
        <path d="M58 62 L58 186 M162 62 L162 186" stroke="${ink}" stroke-width="4"/>`;
      break;
    case "cantilever":
      shape = `
        <rect x="62" y="44" width="96" height="60" rx="10" fill="none" stroke="${ink}" stroke-width="4"/>
        <rect x="58" y="104" width="104" height="18" rx="9" fill="none" stroke="${ink}" stroke-width="4"/>
        <path d="M70 122 C70 160, 70 176, 96 176 M150 122 C150 160, 150 176, 124 176" fill="none" stroke="${ink}" stroke-width="4"/>`;
      break;
    case "slat":
      shape = `
        <rect x="40" y="120" width="140" height="16" rx="6" fill="none" stroke="${ink}" stroke-width="4"/>
        <rect x="40" y="146" width="140" height="16" rx="6" fill="none" stroke="${ink}" stroke-width="4"/>
        <path d="M52 60 L52 120 M168 60 L168 120 M52 60 L168 60" stroke="${ink}" stroke-width="4" fill="none"/>
        ${[0, 1, 2, 3, 4].map((i) => `<rect x="${64 + i * 20}" y="64" width="10" height="52" fill="none" stroke="${ink}" stroke-width="3"/>`).join("")}`;
      break;
    default:
      shape = `
        <path d="M64 46 C64 24, 156 24, 156 46" fill="none" stroke="${ink}" stroke-width="6"/>
        <rect x="58" y="86" width="104" height="22" rx="11" fill="none" stroke="${ink}" stroke-width="4"/>
        <rect x="66" y="112" width="88" height="16" rx="8" fill="none" stroke="${ink}" stroke-width="4"/>
        <path d="M70 128 L64 186 M150 128 L156 186" stroke="${ink}" stroke-width="4" fill="none"/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${g}${shape}</svg>`;
}

/** A hide ground with dot grain and a flaw region. */
export function hideGround(w = 320, h = 260): string {
  const g = grain(w, h, 5, 10, "#b9b9b9", 0.7);
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="14" fill="#efefef" stroke="#d7d7d7"/>
    ${g}
    <rect x="${w * 0.55}" y="${h * 0.28}" width="${w * 0.16}" height="${h * 0.09}" fill="none" stroke="#8f8f8f" stroke-dasharray="3 3"/>
    <rect x="${w * 0.1}" y="${h * 0.78}" width="${w * 0.08}" height="${h * 0.05}" fill="none" stroke="#8f8f8f" stroke-dasharray="3 3"/>
  </svg>`;
}

/** A material swatch: dot-density grain in ink/grey, told apart by grain, name and code. */
export function swatchGrain(code: string, w = 120, h = 90): string {
  const density = (code.charCodeAt(code.length - 1) % 5) + 4;
  const fill = density % 2 === 0 ? "#9a9a9a" : "#6f6f6f";
  const g = grain(w, h, code.charCodeAt(3) ?? 5, density, fill, 0.7);
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><rect width="${w}" height="${h}" rx="10" fill="#e9e9e9"/>${g}</svg>`;
}

/** A condition-map ground with a pin fragment. */
export function conditionGround(w = 320, h = 240): string {
  const g = grain(w, h, 11, 5, "#c4c4c4", 0.5);
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><rect width="${w}" height="${h}" rx="14" fill="#f4f4f4"/>${g}
  <circle cx="${w * 0.3}" cy="${h * 0.42}" r="8" fill="none" stroke="#3a3a3a" stroke-width="3"/>
  <path d="M${w * 0.3} ${h * 0.42} L${w * 0.3} ${h * 0.42 - 22}" stroke="#3a3a3a" stroke-width="3"/></svg>`;
}
