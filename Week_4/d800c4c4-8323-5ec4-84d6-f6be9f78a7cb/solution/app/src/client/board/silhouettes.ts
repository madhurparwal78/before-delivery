// Traced tool silhouettes, drawn from a part's shape kind and its size in holes (never from image files).

const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  r > 0
    ? `M${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x + r}Q${x},${y + h} ${x},${y + h - r}V${y + r}Q${x},${y} ${x + r},${y}Z`
    : `M${x},${y}H${x + w}V${y + h}H${x}Z`;

const circle = (cx: number, cy: number, r: number) => `M${cx - r},${cy}A${r},${r} 0 1 0 ${cx + r},${cy}A${r},${r} 0 1 0 ${cx - r},${cy}Z`;

const poly = (points: Array<[number, number]>) => `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;

type Draw = (x: number, y: number, w: number, h: number) => string;

const drill: Draw = (x, y, w, h) => {
  const band = h * 0.3;
  return [
    rect(x + w * 0.08, y, w * 0.72, band, band * 0.3),
    rect(x + w * 0.8, y + band * 0.28, w * 0.2, band * 0.44, 2),
    poly([
      [x + w * 0.32, y + band],
      [x + w * 0.56, y + band],
      [x + w * 0.5, y + h * 0.78],
      [x + w * 0.3, y + h * 0.78],
    ]),
    rect(x + w * 0.18, y + h * 0.78, w * 0.48, h * 0.22, 3),
  ].join("");
};

const saw: Draw = (x, y, w, h) => {
  if (w >= h * 1.6) {
    // a long toothed blade with a closed grip (hedge trimmer, long saws)
    const bladeH = h * 0.42;
    const top = y + (h - bladeH) / 2;
    const teeth: Array<[number, number]> = [];
    const start = x + w * 0.34;
    const steps = Math.max(4, Math.floor((w * 0.66) / 10));
    for (let i = 0; i <= steps; i++) {
      const tx = start + (i * (w * 0.66)) / steps;
      teeth.push([tx, i % 2 === 0 ? top : top - 5]);
    }
    return [
      rect(x, y + h * 0.12, w * 0.3, h * 0.76, h * 0.2),
      poly([...teeth, [x + w, top + bladeH * 0.5], [x + w, top + bladeH], [start, top + bladeH]]),
    ].join("");
  }
  // a bench saw: base, motor and a toothed round blade
  const r = Math.min(w, h) * 0.34;
  const cx = x + w * 0.5;
  const cy = y + h * 0.42;
  const teeth: Array<[number, number]> = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.86;
    teeth.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return [poly(teeth), rect(x, y + h * 0.78, w, h * 0.22, 3), rect(x + w * 0.72, y + h * 0.1, w * 0.26, h * 0.34, 4)].join("");
};

const ladder: Draw = (x, y, w, h) => {
  const rail = Math.max(5, w * 0.16);
  const parts = [rect(x, y, rail, h, 2), rect(x + w - rail, y, rail, h, 2)];
  const rungs = Math.max(3, Math.floor(h / 30));
  for (let i = 1; i <= rungs; i++) parts.push(rect(x + rail, y + (i * h) / (rungs + 1) - 3, w - 2 * rail, 6));
  return parts.join("");
};

const hammer: Draw = (x, y, w, h) =>
  [
    poly([
      [x, y + h * 0.04],
      [x + w * 0.62, y],
      [x + w, y + h * 0.08],
      [x + w * 0.86, y + h * 0.2],
      [x + w * 0.62, y + h * 0.17],
      [x, y + h * 0.2],
    ]),
    rect(x + w * 0.36, y + h * 0.18, w * 0.28, h * 0.82, w * 0.12),
  ].join("");

const wrench: Draw = (x, y, w, h) => {
  const jaw = Math.min(w, h * 0.3);
  return [
    poly([
      [x, y],
      [x + w * 0.3, y],
      [x + w * 0.38, y + jaw * 0.55],
      [x + w * 0.62, y + jaw * 0.55],
      [x + w * 0.7, y],
      [x + w, y],
      [x + w * 0.86, y + jaw],
      [x + w * 0.14, y + jaw],
    ]),
    rect(x + w * 0.34, y + jaw, w * 0.32, h - jaw, w * 0.14),
  ].join("");
};

const caseShape: Draw = (x, y, w, h) =>
  [
    rect(x + w * 0.34, y, w * 0.32, h * 0.18, 4),
    rect(x, y + h * 0.14, w, h * 0.86, 5),
  ].join("");

const battery: Draw = (x, y, w, h) =>
  [rect(x + w * 0.3, y, w * 0.4, h * 0.14, 2), rect(x, y + h * 0.12, w, h * 0.88, 5)].join("");

const cable: Draw = (x, y, w, h) => {
  const cx = x + w / 2;
  const cy = y + h * 0.46;
  const r = Math.min(w, h) * 0.42;
  return [circle(cx, cy, r), circle(cx, cy, r * 0.62), rect(cx + r * 0.6, cy + r * 0.5, w * 0.08, h - (cy - y) - r * 0.5)].join("");
};

const blade: Draw = (x, y, w, h) => {
  // a toothed disc with its arbor hole cut out
  const r = Math.min(w, h) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const teeth: Array<[number, number]> = [];
  const count = 20;
  for (let i = 0; i < count * 2; i++) {
    const a = (i / (count * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.82;
    teeth.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return [poly(teeth), circle(cx, cy, Math.max(2.5, r * 0.22))].join("");
};

/** The hang tab every generic tool carries at its top, with its peg hole cut out. */
const hangTab = (cx: number, y: number, tabW: number, tabH: number) =>
  [rect(cx - tabW / 2, y, tabW, tabH), circle(cx, y + tabH / 2, Math.max(1.8, Math.min(tabW, tabH) * 0.24))].join("");

const generic: Draw = (x, y, w, h) => {
  const cx = x + w / 2;
  if (h >= w * 1.6) {
    // a bar or lance: hang tab, a moulded grip, a shaft and a flared fitting at the foot
    const tabH = h * 0.08;
    const shaft = Math.max(6, w * 0.26);
    return [
      hangTab(cx, y, w * 0.4, tabH),
      rect(x + w * 0.1, y + tabH, w * 0.8, h * 0.24, w * 0.2),
      rect(cx - shaft / 2, y + tabH + h * 0.24, shaft, h * 0.54),
      poly([
        [cx - shaft / 2, y + h * 0.86],
        [cx + shaft / 2, y + h * 0.86],
        [x + w * 0.82, y + h],
        [x + w * 0.18, y + h],
      ]),
    ].join("");
  }
  if (w >= h * 1.4) {
    // a long instrument (levels): hang tab, carry handle, body with a window and a vial cut out
    const tabH = h * 0.14;
    return [
      hangTab(cx, y, w * 0.14, tabH),
      rect(x + w * 0.2, y + tabH, w * 0.6, h * 0.2, h * 0.08),
      rect(x, y + tabH + h * 0.2, w, h * 0.66, Math.min(8, h * 0.16)),
      rect(x + w * 0.08, y + h * 0.5, w * 0.24, h * 0.28, 2),
      circle(x + w * 0.72, y + h * 0.64, Math.min(w, h) * 0.12),
    ].join("");
  }
  // a power unit (sanders, washers, bags): hang tab, a handle bar on a neck, the body with a dial, a base plate
  const tabH = h * 0.12;
  const r = Math.min(w, h) * 0.12;
  return [
    hangTab(cx, y, w * 0.22, tabH),
    rect(x + w * 0.16, y + tabH, w * 0.68, h * 0.18, r),
    rect(x + w * 0.34, y + tabH + h * 0.18, w * 0.32, h * 0.1),
    rect(x, y + tabH + h * 0.28, w, h * 0.48, r),
    circle(cx, y + tabH + h * 0.52, Math.min(w, h) * 0.13),
    rect(x + w * 0.06, y + tabH + h * 0.76, w * 0.88, h - tabH - h * 0.76, 2),
  ].join("");
};

const DRAWINGS: Record<string, Draw> = {
  drill,
  saw,
  ladder,
  hammer,
  wrench,
  case: caseShape,
  battery,
  cable,
  blade,
  generic,
};

/** The silhouette path for a part box of `width` × `height` pixels, inset so the outline frame stays clear. */
export function silhouette(shape: string, width: number, height: number): { path: string; holes: "evenodd" | "nonzero" } {
  const inset = 11;
  const draw = DRAWINGS[shape] ?? generic;
  const path = draw(inset, inset, width - inset * 2, height - inset * 2);
  // Hang holes, dials and arbor holes of the generic, case and blade shapes are cut out with the even-odd rule.
  return { path, holes: shape === "generic" || shape === "case" || shape === "blade" ? "evenodd" : "nonzero" };
}
