import { s } from "../core/dom.js";

const GRID = 46;

/** Deterministic number in [0, 1) from a string, so every route gets its own quiet ground. */
function seeded(text, salt) {
  let hash = 2166136261 ^ salt;
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 10000) / 10000;
}

/** Equirectangular fit of lat/lon points into a width x height box with padding; returns a project() function. */
export function fitProjection(points, width, height, pad) {
  const lat0 = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const scale = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p[1] * scale);
  const ys = points.map((p) => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
  const k = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offsetX = (width - spanX * k) / 2, offsetY = (height - spanY * k) / 2;
  return (lat, lon) => [offsetX + (lon * scale - minX) * k, height - offsetY - (lat - minY) * k];
}

/** The light map ground: road grid, parks, water and contour lines, all drawn from a seed. */
export function mapGround(seed, width, height, id) {
  const r = (n) => seeded(seed, n);
  const g = s("g", { "aria-hidden": "true" });
  g.append(s("rect", { width, height, fill: "#F3F2EF" }));
  g.append(s("path", { d: `M0 ${height * (0.6 + r(1) * 0.3)} C ${width * 0.3} ${height * (0.5 + r(2) * 0.3)}, ${width * 0.6} ${height * (0.9 + r(3) * 0.2)}, ${width} ${height * (0.55 + r(4) * 0.3)} V${height} H0 Z`, fill: "#00A3A3", opacity: "0.16" }));
  for (let i = 0; i < 3; i++) {
    g.append(s("rect", { x: width * (0.05 + r(10 + i) * 0.8), y: height * (0.05 + r(20 + i) * 0.7), width: width * (0.12 + r(30 + i) * 0.14), height: height * (0.12 + r(40 + i) * 0.16), rx: 14, fill: "#E8DCC2" }));
  }
  const pattern = s("pattern", { id: `roads-${id}`, width: GRID, height: GRID, patternUnits: "userSpaceOnUse", patternTransform: `rotate(${Math.round(r(5) * 24 - 12)})` },
    s("path", { d: `M0 ${GRID / 2}H${GRID}M${GRID / 2} 0V${GRID}`, stroke: "#FFFFFF", "stroke-width": 1.6, opacity: "0.9" }));
  g.append(s("defs", {}, pattern), s("rect", { width, height, fill: `url(#roads-${id})` }));
  for (let i = 0; i < 4; i++) {
    g.append(s("path", { d: `M0 ${height * (0.15 + i * 0.22)} C ${width * 0.3} ${height * (0.05 + i * 0.22 + r(50 + i) * 0.1)}, ${width * 0.7} ${height * (0.3 + i * 0.2)}, ${width} ${height * (0.12 + i * 0.22)}`, fill: "none", stroke: "#8F8881", "stroke-width": 1, opacity: "0.22" }));
  }
  return g;
}

/** A chequered finish marker: a white square holding a 4 x 4 black and white pattern. */
export function finishMarker(x, y, size = 20) {
  const cell = size / 4;
  const g = s("g", { transform: `translate(${x - size / 2} ${y - size / 2})` });
  g.append(s("rect", { width: size, height: size, fill: "#fff", stroke: "#1E1B18", "stroke-width": 1.5, rx: 2 }));
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    if ((row + col) % 2 === 0) g.append(s("rect", { x: col * cell, y: row * cell, width: cell, height: cell, fill: "#1E1B18" }));
  }
  return g;
}

/**
 * The route drawn on the map ground: white casing under an orange line, a green start dot, a chequered finish.
 * `points` are [lat, lon] pairs. Returns the svg and a `at(index)` projection for markers.
 */
export function routeMap(points, { width = 640, height = 360, label, seed = "", id = "map", compact = false } = {}) {
  const svg = s("svg", { class: "route-map", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label });
  svg.append(mapGround(seed || String(points[0] || ""), width, height, id));
  if (!points.length) return { svg, project: null };
  const project = fitProjection(points, width, height, compact ? 14 : 36);
  const xy = points.map((p) => project(p[0], p[1]));
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
  svg.append(s("path", { d, fill: "none", stroke: "#fff", "stroke-width": compact ? 6 : 9, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  svg.append(s("path", { class: "route-line-orange", d, fill: "none", stroke: "#D93D00", "stroke-width": compact ? 3.5 : 5, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  const first = xy[0], last = xy[xy.length - 1];
  svg.append(s("circle", { cx: first[0], cy: first[1], r: compact ? 5 : 8, fill: "#4A6B00", stroke: "#fff", "stroke-width": 2.5 }));
  svg.append(finishMarker(last[0], last[1], compact ? 14 : 22));
  return { svg, project };
}
