// Scene geometry: the loaf's proportions, the orthographic camera and the screen measurements it publishes.

/** Loaf proportions in bar widths. */
export const HEIGHT = 2.6;
export const DEPTH = 2.6;
export const DOME = 0.2;
/** The lengthwise crown: the top rises toward the middle of the loaf, as it does out of a wooden mould. */
export const CROWN = 0.26;
/** The crown's extra height above HEIGHT at x (bar widths from the loaf centre) on a loaf of `bars` bars. */
export const crown = (x: number, bars: number) => CROWN * (1 - ((2 * x) / bars) ** 2);
/** Cut slices tip over onto a cut face and lie in front of the loaf, below its band. */
export const FALL_FORWARD = DEPTH * 1.05;
export const FALL_DROP = 1.75;
/** A fallen slice slides right by half its height, so the fallen row is centred under the loaf. */
export const FALL_SHIFT = HEIGHT / 2;
const PITCH = (20 * Math.PI) / 180;

export const SCROLL_TRAVEL = 2400;

/** The published scroll values, all from the integer offset s in integer arithmetic. */
export function scrollValues(scrollY: number, bars: number) {
  const s = Math.max(0, Math.min(SCROLL_TRAVEL, Math.floor(scrollY)));
  const p = Math.floor((s * 1000 + 1200) / SCROLL_TRAVEL);
  const w = Math.floor((s * bars) / 24);
  return {
    s,
    progress: `${Math.floor(p / 1000)}.${String(p % 1000).padStart(3, '0')}`,
    wire: `${Math.floor(w / 100)}.${String(w % 100).padStart(2, '0')}`,
    cutStep: Math.floor((s * bars) / SCROLL_TRAVEL),
  };
}

/** The deep-link scroll position for bar k of n. */
export const deepLinkY = (k: number, n: number) => Math.ceil((SCROLL_TRAVEL * k) / n);

export interface Camera {
  /** Pixels per bar width. */
  scale: number;
  /** Screen position (CSS px, figure box) of the loaf centre at ground level. */
  cx: number;
  cy: number;
  yaw: number;
}

type Vec3 = [number, number, number];

/** Rotates a loaf-centred point by yaw, then pitches it toward the camera: returns [screenX, up, depth]. */
function view(p: Vec3, yawDeg: number): Vec3 {
  const a = (yawDeg * Math.PI) / 180;
  const x1 = p[0] * Math.cos(a) + p[2] * Math.sin(a);
  const z1 = -p[0] * Math.sin(a) + p[2] * Math.cos(a);
  const up = p[1] * Math.cos(PITCH) - z1 * Math.sin(PITCH);
  const depth = p[1] * Math.sin(PITCH) + z1 * Math.cos(PITCH);
  return [x1, up, depth];
}

const toScreen = (cam: Camera, p: Vec3): [number, number] => {
  const v = view(p, cam.yaw);
  return [cam.cx + v[0] * cam.scale, cam.cy - v[1] * cam.scale];
};

/** Fits the loaf, its fallen slices and the wire into the figure box, the same at every yaw and step. */
export function fit(bars: number, width: number, height: number): Omit<Camera, 'yaw'> {
  const half = bars / 2;
  const corners: Vec3[] = [];
  // A fallen slice lies its full height (crown included) to the left of its slot, less FALL_SHIFT.
  const overhang = HEIGHT + DOME + CROWN - FALL_SHIFT + 0.2;
  for (const x of [-half - overhang, half + overhang]) {
    for (const y of [-FALL_DROP, HEIGHT + DOME + CROWN + 0.2]) {
      for (const z of [-DEPTH / 2 - 0.5, DEPTH / 2 + FALL_FORWARD + DEPTH / 2]) corners.push([x, y, z]);
    }
  }
  const projected = corners.map((c) => view(c, 0));
  const minX = Math.min(...projected.map((v) => v[0]));
  const maxX = Math.max(...projected.map((v) => v[0]));
  const minUp = Math.min(...projected.map((v) => v[1]));
  const maxUp = Math.max(...projected.map((v) => v[1]));
  const scale = Math.min((width * 0.98) / (maxX - minX), (height * 0.9) / (maxUp - minUp));
  // Spare height goes mostly below, so the loaf sits high and the fallen slices have the lower half.
  const top = (height - (maxUp - minUp) * scale) * 0.3;
  return {
    scale,
    cx: width / 2 - ((minX + maxX) / 2) * scale,
    cy: top + maxUp * scale,
  };
}

const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v)));

/** Each bar's front-face slot along the band's middle row: the screen edges of its two cut planes. */
export function barSpans(cam: Camera, bars: number, width: number): [number, number][] {
  const half = bars / 2;
  const edge = (x: number) => clamp(toScreen(cam, [x - half, HEIGHT / 2, DEPTH / 2])[0], width);
  return Array.from({ length: bars }, (_, i) => [edge(i), edge(i + 1)]);
}

/** The top and bottom of the standing loaf on screen. */
export function loafBand(cam: Camera, bars: number, height: number): [number, number] {
  const half = bars / 2;
  const ys: number[] = [];
  for (const x of [-half, 0, half]) {
    for (const z of [-DEPTH / 2, 0, DEPTH / 2]) {
      const top = HEIGHT + crown(x, bars) + DOME * (1 - (2 * z) / DEPTH) * (1 + (2 * z) / DEPTH);
      ys.push(toScreen(cam, [x, top, z])[1], toScreen(cam, [x, 0, z])[1]);
    }
  }
  return [clamp(Math.min(...ys), height), clamp(Math.max(...ys), height)];
}
