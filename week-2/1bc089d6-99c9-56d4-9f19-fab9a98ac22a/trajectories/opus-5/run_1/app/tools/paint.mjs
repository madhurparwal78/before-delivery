// Procedural painters shared by the film and the ritual clips.
// Everything is drawn pixel by pixel in the Stillhour palette; no source images.

export const NIGHT = [11, 9, 20];
export const DUSK_VIOLET = [46, 33, 72];
export const DUSK_LILAC = [226, 216, 240];
export const EMBER = [255, 138, 61];
export const MOONLIGHT = [245, 238, 230];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, k) => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function createFrame(w, h) {
  return { w, h, data: new Uint8Array(w * h * 3) };
}

export function put(f, x, y, rgb) {
  const i = (y * f.w + x) * 3;
  f.data[i] = rgb[0] < 0 ? 0 : rgb[0] > 255 ? 255 : rgb[0];
  f.data[i + 1] = rgb[1] < 0 ? 0 : rgb[1] > 255 ? 255 : rgb[1];
  f.data[i + 2] = rgb[2] < 0 ? 0 : rgb[2] > 255 ? 255 : rgb[2];
}

export function vignetteAndGrain(f, strength = 0.45) {
  const { w, h, data } = f;
  const cx = w / 2;
  const cy = h / 2;
  const max = Math.hypot(cx, cy);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.hypot(x - cx, y - cy) / max;
      const k = 1 - strength * d * d;
      const g = (hash(x, y) - 0.5) * 5;
      const i = (y * w + x) * 3;
      data[i] = Math.max(0, Math.min(255, data[i] * k + g));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * k + g));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * k + g));
    }
  }
}

function glow(colour, base, strength) {
  return mix(base, colour, clamp01(strength));
}

// Scene one: contour landscape under a sinking ember sun.
export function paintHorizon(f, t) {
  const { w, h } = f;
  const horizon = h * 0.62;
  const sunY = h * (0.40 + 0.20 * t);
  const sunR = h * 0.085;
  const sky = (y) => {
    const k = clamp01(y / horizon);
    const high = mix([24, 18, 44], NIGHT, t * 0.7);
    const low = mix([120, 86, 120], [52, 36, 70], t);
    return mix(high, low, Math.pow(k, 1.3));
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let c;
      if (y < horizon) {
        c = sky(y);
        const d = Math.hypot(x - w * 0.5, (y - sunY) * 1.15);
        c = glow(mix(EMBER, [255, 214, 170], 0.3), c, Math.exp(-d / (sunR * 3.4)) * (0.85 - 0.25 * t));
        if (d < sunR) c = mix(c, [255, 226, 190], 0.92);
      } else {
        const q = (y - horizon) / (h - horizon);
        c = mix([30, 22, 48], NIGHT, q);
        // Glowing contour lines of a dark landscape.
        const u = (x / w) * 6;
        const ridge = Math.sin(u * 1.7 + 0.6) * 0.5 + Math.sin(u * 0.9 - 1.2) * 0.3;
        const bands = 11;
        for (let b = 0; b < bands; b += 1) {
          const line = (b + 1) / (bands + 1);
          const yy = horizon + (h - horizon) * line + ridge * h * 0.035 * (1 - line);
          const d = Math.abs(y - yy);
          if (d < 1.6) {
            const fade = (1 - line) * (0.55 - 0.25 * t);
            c = glow(EMBER, c, (1 - d / 1.6) * fade);
          }
        }
      }
      put(f, x, y, c);
    }
  }
}

// Scene two: the skyline losing its windows.
export function paintCity(f, t) {
  const { w, h } = f;
  const base = h * 0.86;
  const cols = 26;
  const colW = w / cols;
  const towers = [];
  for (let i = 0; i < cols; i += 1) {
    const depth = hash(i, 3.1);
    towers.push({
      x0: i * colW,
      x1: (i + 1) * colW - Math.max(1, colW * 0.12),
      top: base - h * (0.16 + 0.42 * hash(i, 7.7)),
      depth,
    });
  }
  const lit = 1 - smooth(0.05, 0.95, t);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let c = mix(mix([34, 24, 56], NIGHT, 0.2), NIGHT, clamp01(y / base));
      const starSeed = hash(Math.floor(x / 2), Math.floor(y / 2));
      if (y < base * 0.7 && starSeed > 0.9985) c = mix(c, MOONLIGHT, 0.7);
      for (const tw of towers) {
        if (x >= tw.x0 && x <= tw.x1 && y >= tw.top && y < base) {
          c = mix([18, 14, 30], [8, 7, 14], 1 - tw.depth);
          const gx = Math.floor((x - tw.x0) / Math.max(3, colW * 0.26));
          const gy = Math.floor((y - tw.top) / Math.max(4, h * 0.035));
          const cellX = (x - tw.x0) % Math.max(3, colW * 0.26);
          const cellY = (y - tw.top) % Math.max(4, h * 0.035);
          const onCell = cellX > 1 && cellX < Math.max(3, colW * 0.26) - 1.5 && cellY > 1.5 && cellY < Math.max(4, h * 0.035) - 2.5;
          if (onCell) {
            const seed = hash(gx * 13.3 + tw.x0, gy * 7.1);
            // The farthest towers go dark first.
            const threshold = lit * (0.55 + 0.45 * tw.depth);
            if (seed < threshold) c = mix(c, mix(EMBER, [255, 206, 150], 0.35), 0.9);
          }
        }
      }
      if (y >= base) c = mix([14, 11, 24], NIGHT, (y - base) / (h - base));
      put(f, x, y, c);
    }
  }
}

// Scene three: still water, a paper boat drifting to the centre.
export function paintWater(f, t) {
  const { w, h } = f;
  const horizon = h * 0.45;
  const moonX = w * 0.62;
  const moonY = horizon * 0.42;
  const moonR = h * 0.07;
  const calm = smooth(0, 1, t);
  const boatX = w * (0.2 + 0.3 * calm);
  const boatY = horizon + (h - horizon) * 0.42;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let c;
      if (y < horizon) {
        c = mix([22, 16, 40], [44, 32, 62], clamp01(y / horizon));
        const d = Math.hypot(x - moonX, y - moonY);
        c = glow(MOONLIGHT, c, Math.exp(-d / (moonR * 3)) * 0.5);
        if (d < moonR) c = mix(c, MOONLIGHT, 0.95);
        if (hash(x, y) > 0.9988) c = mix(c, MOONLIGHT, 0.6);
      } else {
        const q = (y - horizon) / (h - horizon);
        c = mix([20, 15, 36], [7, 6, 13], q);
        const amp = (1 - calm) * 7 + 0.6;
        const wob = Math.sin((x / w) * 40 + q * 18) * amp * 0.5 + Math.sin((x / w) * 13 - q * 9) * amp;
        const reflect = Math.exp(-Math.abs(x + wob - moonX) / (moonR * (1.5 + 3 * (1 - calm)))) * Math.exp(-q * 2.2);
        c = glow(mix(MOONLIGHT, [190, 200, 230], 0.4), c, reflect * 0.65);
        const lineY = Math.sin(x * 0.08 + q * 30) * amp;
        if (Math.abs(((y - horizon) % Math.max(5, 16 - 10 * calm)) - 2 + lineY * 0.3) < 0.7) {
          c = glow([120, 130, 170], c, 0.10 * (1 - calm * 0.7));
        }
        // A small paper boat: hull and sail.
        const bx = x - boatX;
        const by = y - boatY;
        const hull = by > -1 && by < h * 0.018 && Math.abs(bx) < h * 0.03 * (1 - by / (h * 0.02) * 0.4);
        const sail = by <= -1 && by > -h * 0.055 && bx > -h * 0.004 && bx < h * 0.03 + by * 0.5;
        if (hull || sail) c = mix(MOONLIGHT, [214, 206, 224], 0.35);
      }
      put(f, x, y, c);
    }
  }
}

// Scene four: the paper lantern going out.
export function paintLantern(f, t) {
  const { w, h } = f;
  const cx = w * 0.5;
  const cy = h * 0.52;
  const flame = 1 - smooth(0, 1, t);
  const rx = h * 0.085;
  const ry = h * 0.115;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let c = mix([18, 14, 30], NIGHT, clamp01(Math.hypot((x - cx) / w, (y - cy) / h) * 2.2));
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const halo = Math.exp(-Math.hypot(x - cx, y - cy) / (rx * (2.6 * flame + 0.6)));
      c = glow(mix(EMBER, [255, 190, 130], 0.25), c, halo * (0.75 * flame + 0.02));
      if (d < 1) {
        const paper = mix([58, 40, 60], mix(EMBER, [255, 226, 190], 0.45), 0.25 + 0.7 * flame * (1 - d * 0.6));
        c = mix(c, paper, 0.95);
        const fd = Math.hypot((x - cx) / (rx * 0.22), (y - cy + ry * 0.1) / (ry * 0.3 * (0.25 + 0.75 * flame)));
        if (fd < 1) c = mix(c, mix([255, 240, 215], EMBER, fd * 0.6), 0.9 * (0.25 + 0.75 * flame));
      }
      if (Math.abs(y - (cy - ry)) < 1.2 && Math.abs(x - cx) < rx * 0.9) c = mix(c, [120, 100, 120], 0.8);
      if (Math.abs(x - cx) < 1 && y < cy - ry) c = mix(c, [90, 76, 98], 0.7);
      put(f, x, y, c);
    }
  }
}

const RITUAL_PAINTERS = {
  // Two lamps dimming one after the other.
  'dim-lamps': (f, p) => {
    const { w, h } = f;
    const lamps = [
      { x: w * 0.33, y: h * 0.46, phase: 0 },
      { x: w * 0.66, y: h * 0.54, phase: 0.5 },
    ];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let c = mix([30, 22, 48], NIGHT, clamp01(y / h));
        for (const l of lamps) {
          const level = 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (p + l.phase)));
          const d = Math.hypot(x - l.x, y - l.y);
          c = glow(EMBER, c, Math.exp(-d / (h * 0.16)) * level * 0.85);
          if (d < h * 0.05) c = mix(c, mix(EMBER, [255, 230, 200], level), 0.85);
          const cone = y > l.y && Math.abs(x - l.x) < (y - l.y) * 0.55;
          if (cone) c = glow(EMBER, c, 0.10 * level * (1 - (y - l.y) / h));
        }
        put(f, x, y, c);
      }
    }
  },
  // Warm water falling in soft streaks.
  'warm-shower': (f, p) => {
    const { w, h } = f;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let c = mix([38, 28, 58], [16, 12, 28], clamp01(y / h));
        for (let s = 0; s < 22; s += 1) {
          const sx = ((s * 97) % 100) / 100 * w;
          const speed = 0.6 + ((s * 37) % 50) / 100;
          const off = ((p * speed + s * 0.17) % 1) * h * 1.6 - h * 0.3;
          const d = Math.hypot((x - sx) / 1.6, (y - off) / (h * 0.16));
          if (d < 1) c = glow(mix(EMBER, [240, 226, 230], 0.6), c, (1 - d) * 0.55);
        }
        const steam = Math.sin(x * 0.05 + p * 6.283) * 0.5 + 0.5;
        c = glow([200, 190, 210], c, steam * 0.05 * (1 - y / h));
        put(f, x, y, c);
      }
    }
  },
  // A page of paper, turning.
  'paper-not-pixels': (f, p) => {
    const { w, h } = f;
    const lift = Math.sin(2 * Math.PI * p);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let c = mix([34, 25, 52], NIGHT, clamp01(y / h));
        const px = (x - w * 0.5) / (w * 0.26);
        const py = (y - h * 0.5) / (h * 0.34);
        if (Math.abs(px) < 1 && Math.abs(py) < 1) {
          const shade = 0.78 + 0.18 * (1 - Math.abs(px)) + lift * 0.08 * px;
          c = mix([214, 205, 192], [238, 232, 222], shade);
          const lines = Math.abs(((y - h * 0.5) % (h * 0.085)) - h * 0.0425);
          if (lines < 1.1 && Math.abs(px) < 0.82) c = mix(c, [120, 112, 128], 0.5);
        }
        const d = Math.hypot(x - w * 0.5, y - h * 0.5);
        c = glow(EMBER, c, Math.exp(-d / (h * 0.9)) * 0.1);
        put(f, x, y, c);
      }
    }
  },
  // Tomorrow's three lines, ticked one by one.
  'tomorrow-list': (f, p) => {
    const { w, h } = f;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let c = mix([32, 24, 50], NIGHT, clamp01(y / h));
        for (let i = 0; i < 3; i += 1) {
          const ry = h * (0.3 + i * 0.2);
          const on = 0.5 + 0.5 * Math.cos(2 * Math.PI * (p - i * 0.18));
          const box = Math.abs(x - w * 0.26) < h * 0.045 && Math.abs(y - ry) < h * 0.045;
          const edge = box && (Math.abs(Math.abs(x - w * 0.26) - h * 0.045) < 1.4 || Math.abs(Math.abs(y - ry) - h * 0.045) < 1.4);
          if (edge) c = mix(c, DUSK_LILAC, 0.75);
          if (box && !edge) c = glow(EMBER, c, on * 0.55);
          const line = y > ry - 1.6 && y < ry + 1.6 && x > w * 0.36 && x < w * (0.5 + 0.22 * (1 - i * 0.2));
          if (line) c = mix(c, DUSK_LILAC, 0.55);
        }
        put(f, x, y, c);
      }
    }
  },
  // A slow stretch: an arc reaching and relaxing.
  'slow-stretch': (f, p) => {
    const { w, h } = f;
    const reach = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let c = mix([36, 26, 56], NIGHT, clamp01(y / h));
        const u = (x - w * 0.18) / (w * 0.64);
        if (u >= 0 && u <= 1) {
          const arc = h * (0.72 - (0.18 + 0.26 * reach) * Math.sin(Math.PI * u));
          const d = Math.abs(y - arc);
          if (d < 3.2) c = glow(mix(EMBER, [255, 220, 190], 0.4), c, (1 - d / 3.2) * 0.9);
          if (d < 14) c = glow(EMBER, c, (1 - d / 14) * 0.12);
        }
        put(f, x, y, c);
      }
    }
  },
  // The breathing circle.
  breathe: (f, p) => {
    const { w, h } = f;
    const size = 0.46 + 0.3 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p));
    const r = h * 0.4 * size;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let c = mix([30, 22, 48], NIGHT, clamp01(y / h));
        const d = Math.hypot(x - w * 0.5, y - h * 0.5);
        c = glow(EMBER, c, Math.exp(-Math.abs(d - r) / (h * 0.09)) * 0.5);
        if (Math.abs(d - r) < 2.4) c = glow(mix(EMBER, [255, 226, 200], 0.5), c, 0.95);
        if (d < r) c = glow(EMBER, c, 0.06);
        put(f, x, y, c);
      }
    }
  },
};

export function paintRitual(id, f, p) {
  const painter = RITUAL_PAINTERS[id];
  painter(f, p);
  vignetteAndGrain(f, 0.3);
}

// The 40-second film: four scenes of one evening, cross-faded.
export function paintFilm(f, seconds) {
  const scenes = [
    { paint: paintHorizon, start: 0, end: 11 },
    { paint: paintCity, start: 10, end: 21 },
    { paint: paintWater, start: 20, end: 31 },
    { paint: paintLantern, start: 30, end: 40 },
  ];
  const fade = 1.2;
  const active = [];
  for (const s of scenes) {
    if (seconds >= s.start && seconds <= s.end) {
      const local = (seconds - s.start) / (s.end - s.start);
      let weight = 1;
      if (seconds < s.start + fade && s.start > 0) weight = (seconds - s.start) / fade;
      if (seconds > s.end - fade && s.end < 40) weight = Math.min(weight, (s.end - seconds) / fade);
      active.push({ paint: s.paint, local, weight: clamp01(weight) });
    }
  }
  if (active.length === 1) {
    active[0].paint(f, active[0].local);
  } else {
    const a = createFrame(f.w, f.h);
    const b = createFrame(f.w, f.h);
    active[0].paint(a, active[0].local);
    active[1].paint(b, active[1].local);
    const k = active[1].weight / (active[0].weight + active[1].weight);
    for (let i = 0; i < f.data.length; i += 1) {
      f.data[i] = a.data[i] + (b.data[i] - a.data[i]) * k;
    }
  }
  vignetteAndGrain(f, 0.5);
}
